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
  fs.writeFile(p, serialize(state), (err) => {
    if (err) return callback(err);
    callback(null, state);
  });
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
    callback(null, deserialize(data));
  });
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function del(configuration, callback) {
  let { key, gid } = helper(configuration);

  const p = getPath(gid, key);
  fs.readFile(p, 'utf8', (err, data) => {
    if (err) return callback(new Error('Key not found'));
    fs.unlink(p, (err2) => {
      if (err2) return callback(err2);
      callback(null, deserialize(data));
    });
  });
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
  try {
    let arr = [];
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      const existing = deserialize(data);
      if (Array.isArray(existing)) {
        arr = existing;
      }
    }
    arr.push(state);
    fs.writeFileSync(p, serialize(arr));
    callback(null, arr);
  } catch (err) {
    callback(err);
  }
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

  try {
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
    for (const [key, values] of grouped.entries()) {
      const p = getPath(gid, key);
      let arr = [];
      if (fs.existsSync(p)) {
        const data = fs.readFileSync(p, 'utf8');
        const existing = deserialize(data);
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
      fs.writeFileSync(p, serialize(arr));
    }

    callback(null, { keys: grouped.size, appended });
  } catch (err) {
    callback(err);
  }
}

module.exports = { put, get, del, append, batchAppend };
