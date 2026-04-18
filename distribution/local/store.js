// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 *
 * @typedef {Object} StoreConfig
 * @property {?string} key
 * @property {?string} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */

const fs = require('fs');
const path = require('path');
const id = require('../util/id.js');
const { serialize, deserialize } = require('../util/serialization.js');

const writeQueues = new Map();

function safeDeserialize(data, filePath) {
  try {
    return deserialize(data);
  } catch (error) {
    const wrapped = new Error(`Corrupt store record at ${filePath}: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function atomicWriteFileSync(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tempPath, data, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function queueFileMutation(filePath, mutation, callback) {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => Promise.resolve().then(mutation));

  writeQueues.set(filePath, current);

  current
    .then((result) => callback(null, result))
    .catch((error) => callback(error))
    .finally(() => {
      if (writeQueues.get(filePath) === current) {
        writeQueues.delete(filePath);
      }
    });
}

function getPath(gid, key) {
  const nid = globalThis.distribution.node.config.nid || id.getNID(globalThis.distribution.node.config);
  const safeKey = key === null ? 'null' : Buffer.from(key).toString('hex');
  const dir = path.join(__dirname, '..', '..', 'store', nid, gid);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, safeKey);
}

function helper(configuration) {
  let key = null;
  let gid = 'local';
  if (typeof configuration === 'string') {
    key = configuration;
  } else if (configuration) {
    key = configuration.key || null;
    gid = configuration.gid || 'local';
  }

  return { key, gid };
}

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function put(state, configuration, callback) {
  let { key, gid } = helper(configuration);

  if (!key) {
    key = id.getID(state);
  }

  const p = getPath(gid, key);
  queueFileMutation(p, () => {
    atomicWriteFileSync(p, serialize(state));
    return state;
  }, callback);
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  let { key, gid } = helper(configuration);

  if (key === null) {
    const nid = globalThis.distribution.node.config.nid || id.getNID(globalThis.distribution.node.config);
    const dir = path.join(__dirname, '..', '..', 'store', nid, gid);
    if (!fs.existsSync(dir)) {
      return callback(null, []);
    }
    fs.readdir(dir, (err, files) => {
      if (err) return callback(err);
      return callback(null, files.map((f) => Buffer.from(f, 'hex').toString()));
    });
    return;
  }

  const p = getPath(gid, key);
  fs.readFile(p, 'utf8', (err, data) => {
    if (err) return callback(new Error('Key not found'));
    try {
      callback(null, safeDeserialize(data, p));
    } catch (parseError) {
      callback(parseError);
    }
  });
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function del(configuration, callback) {
  let { key, gid } = helper(configuration);

  const p = getPath(gid, key);
  queueFileMutation(p, () => {
    if (!fs.existsSync(p)) {
      throw new Error('Key not found');
    }

    const data = fs.readFileSync(p, 'utf8');
    const decoded = safeDeserialize(data, p);
    fs.unlinkSync(p);
    return decoded;
  }, callback);
}

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function append(state, configuration, callback) {
  let { key, gid } = helper(configuration);

  if (!key) {
    key = id.getID(state);
  }

  const p = getPath(gid, key);
  queueFileMutation(p, () => {
    let arr = [];
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      const existing = safeDeserialize(data, p);
      if (Array.isArray(existing)) {
        arr = existing;
      }
    }
    arr.push(state);
    atomicWriteFileSync(p, serialize(arr));
    return arr;
  }, callback);
}

/**
 * @param {{key: string, value: any}[]} entries
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function batchAppend(entries, configuration, callback) {
  const { gid } = helper(configuration);

  if (!Array.isArray(entries)) {
    callback(new Error('local.store.batchAppend: entries must be an array'));
    return;
  }

  const grouped = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    if (!grouped.has(entry.key)) {
      grouped.set(entry.key, []);
    }
    grouped.get(entry.key).push(entry.value);
  }

  let appended = 0;
  const tasks = [];
  for (const [key, values] of grouped.entries()) {
    const p = getPath(gid, key);
    tasks.push(new Promise((resolve, reject) => {
      queueFileMutation(p, () => {
        let arr = [];
        if (fs.existsSync(p)) {
          const data = fs.readFileSync(p, 'utf8');
          const existing = safeDeserialize(data, p);
          if (Array.isArray(existing)) {
            arr = existing;
          } else if (existing !== undefined) {
            arr = [existing];
          }
        }

        for (const value of values) {
          arr.push(value);
          appended += 1;
        }
        atomicWriteFileSync(p, serialize(arr));
        return null;
      }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }));
  }

  Promise.all(tasks)
    .then(() => callback(null, { keys: grouped.size, appended }))
    .catch((error) => callback(error));
}

module.exports = { put, get, del, append, batchAppend };
