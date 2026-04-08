// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").Node} Node
 */


/**
 * @typedef {Object} StoreConfig
 * @property {string | null} key
 * @property {string} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 *
 * @typedef {Object} Mem
 * @property {(configuration: SimpleConfig, callback: Callback) => void} get
 * @property {(state: any, configuration: SimpleConfig, callback: Callback) => void} put
 * @property {(state: any, configuration: SimpleConfig, callback: Callback) => void} append
 * @property {(configuration: SimpleConfig, callback: Callback) => void} del
 * @property {(configuration: Object.<string, Node>, callback: Callback) => void} reconf
 */

const id = require('../util/id.js');

function helper(configuration) {
  let key = null;
  let gid = null;
  if (typeof configuration === 'string') {
    key = configuration;
  } else if (configuration) {
    key = configuration.key || null;
    gid = configuration.gid || null;
  }
  return { key, gid };
}

/**
 * Given nodes map (SID -> Node), compute NIDs and hash kid to find target node.
 * Returns the target node object.
 */
function hashToNode(kid, nodes, hashFn) {
  const nodeEntries = Object.values(nodes);
  const nids = nodeEntries.map((node) => id.getNID(node));
  const chosenNid = hashFn(kid, nids);
  const idx = nids.indexOf(chosenNid);
  return nodeEntries[idx];
}

/**
 * @param {Config} config
 * @returns {Mem}
 */
function mem(config) {
  const context = {};
  context.gid = config.gid || 'all';
  context.hash = config.hash || globalThis.distribution.util.id.naiveHash;

  function normalizeNodeMap(nodes) {
    const normalized = {};
    for (const [sid, node] of Object.entries(nodes || {})) {
      if (node && node.ip && node.port) {
        normalized[sid] = { ip: node.ip, port: node.port };
      }
    }
    return normalized;
  }

  function putGroupOnNodes(nodes, gid, group, done) {
    const entries = Object.entries(nodes);
    if (entries.length === 0) {
      done(null, {});
      return;
    }

    const errors = {};
    const values = {};
    let count = 0;

    for (const [sid, node] of entries) {
      const remote = { node, service: 'groups', method: 'put' };
      globalThis.distribution.local.comm.send([{ gid }, group], remote, (e, v) => {
        if (e) {
          errors[sid] = e;
        } else {
          values[sid] = v;
        }
        count += 1;
        if (count === entries.length) {
          done(Object.keys(errors).length > 0 ? errors : null, values);
        }
      });
    }
  }

  /**
   * @param {SimpleConfig} configuration
   * @param {Callback} callback
   */
  function get(configuration, callback) {
    const { key, gid: configGid } = helper(configuration);
    const effectiveGid = configGid || context.gid;

    if (key === null) {
      globalThis.distribution.local.groups.get(context.gid, (e, nodes) => {
        if (e || Object.keys(nodes).length === 0) return callback(e || new Error('No nodes'), []);

        let allKeys = [];
        let errors = [];
        let completed = 0;
        const sids = Object.keys(nodes);

        sids.forEach((sid) => {
          const remote = { node: nodes[sid], service: 'mem', method: 'get' };
          const config = { key: null, gid: effectiveGid };
          globalThis.distribution.local.comm.send([config], remote, (err, keys) => {
            completed++;
            if (!err && Array.isArray(keys)) {
              allKeys = allKeys.concat(keys);
            } else if (err) {
              errors.push(err);
            }
            if (completed === sids.length) {
              if (errors.length > 0 && allKeys.length === 0) {
                callback(errors[0], []);
              } else {
                callback(null, allKeys);
              }
            }
          });
        });
      });
      return;
    }

    const kid = id.getID(key);
    globalThis.distribution.local.groups.get(context.gid, (e, nodes) => {
      if (e) {
        return callback(e);
      }

      const node = hashToNode(kid, nodes, context.hash);
      globalThis.distribution.local.comm.send([{ key, gid: effectiveGid }], { node, service: 'mem', method: 'get' }, callback);
    });
  }

  /**
   * @param {any} state
   * @param {SimpleConfig} configuration
   * @param {Callback} callback
   */
  function put(state, configuration, callback) {
    const { key: parsedKey, gid: configGid } = helper(configuration);
    let key = parsedKey;
    const effectiveGid = configGid || context.gid;

    if (!key) {
      key = id.getID(state);
    }

    const kid = id.getID(key);
    globalThis.distribution.local.groups.get(context.gid, (e, nodes) => {
      if (e) {
        return callback(e);
      }

      if (Object.keys(nodes).length === 0) {
        return callback(new Error('all.mem.put: No nodes in group'));
      }

      const node = hashToNode(kid, nodes, context.hash);
      globalThis.distribution.local.comm.send([state, { key, gid: effectiveGid }], { node, service: 'mem', method: 'put' }, callback);
    });
  }

  /**
   * @param {any} state
   * @param {SimpleConfig} configuration
   * @param {Callback} callback
   */
  function append(state, configuration, callback) {
    const { key: parsedKey, gid: configGid } = helper(configuration);
    let key = parsedKey;
    const effectiveGid = configGid || context.gid;

    if (!key) {
      key = id.getID(state);
    }

    const kid = id.getID(key);
    globalThis.distribution.local.groups.get(context.gid, (e, nodes) => {
      if (e) {
        return callback(e);
      }

      if (Object.keys(nodes).length === 0) {
        return callback(new Error('all.mem.append: No nodes in group'));
      }

      const node = hashToNode(kid, nodes, context.hash);
      globalThis.distribution.local.comm.send([state, { key, gid: effectiveGid }], { node, service: 'mem', method: 'append' }, callback);
    });
  }

  /**
   * @param {SimpleConfig} configuration
   * @param {Callback} callback
   */
  function del(configuration, callback) {
    const { key, gid: configGid } = helper(configuration);
    const effectiveGid = configGid || context.gid;

    const kid = id.getID(key);
    globalThis.distribution.local.groups.get(context.gid, (e, nodes) => {
      if (e) {
        return callback(e);
      }

      if (Object.keys(nodes).length === 0) {
        return callback(new Error('all.mem.del: No nodes in group'));
      }

      const node = hashToNode(kid, nodes, context.hash);
      globalThis.distribution.local.comm.send([{ key, gid: effectiveGid }], { node, service: 'mem', method: 'del' }, callback);
    });
  }

  /**
   * @param {Object.<string, Node>} configuration
   * @param {Callback} callback
   */
  function reconf(configuration, callback) {
    callback = callback || function () { };

    const newGroup = normalizeNodeMap(configuration);
    if (Object.keys(newGroup).length === 0) {
      callback(new Error('mem.reconf: new group is empty'));
      return;
    }

    globalThis.distribution.local.groups.get(context.gid, (oldGroupErr, oldGroupRaw) => {
      if (oldGroupErr) {
        callback(oldGroupErr);
        return;
      }

      const oldGroup = normalizeNodeMap(oldGroupRaw);
      const unionGroup = { ...oldGroup, ...newGroup };

      get({ key: null, gid: context.gid }, (keysErr, keyList) => {
        if (keysErr) {
          callback(keysErr);
          return;
        }

        const keys = Array.from(new Set((keyList || []).map(String)));
        const snapshot = {};

        let fetched = 0;
        const fetchAll = keys.length === 0;
        if (fetchAll) {
          finalizeReconf();
          return;
        }

        for (const key of keys) {
          get({ key, gid: context.gid }, (readErr, value) => {
            if (!readErr) {
              snapshot[key] = value;
            }
            fetched += 1;
            if (fetched === keys.length) {
              finalizeReconf();
            }
          });
        }

        function finalizeReconf() {
          putGroupOnNodes(unionGroup, context.gid, newGroup, (putGroupErr) => {
            if (putGroupErr) {
              callback(putGroupErr);
              return;
            }

            const writes = Object.entries(snapshot);
            let writeDone = 0;

            if (writes.length === 0) {
              callback(null, { moved: 0, groupSize: Object.keys(newGroup).length });
              return;
            }

            for (const [key, value] of writes) {
              put(value, { key, gid: context.gid }, () => {
                writeDone += 1;
                if (writeDone === writes.length) {
                  cleanupOldCopies();
                }
              });
            }
          });
        }

        function cleanupOldCopies() {
          const cleanups = [];
          const newNids = Object.values(newGroup).map((node) => id.getNID(node));

          for (const key of Object.keys(snapshot)) {
            const kid = id.getID(key);
            const targetNid = context.hash(kid, newNids);
            const targetNode = Object.values(newGroup).find((node) => id.getNID(node) === targetNid);

            for (const [sid, node] of Object.entries(oldGroup)) {
              if (targetNode && id.getNID(node) === id.getNID(targetNode)) {
                continue;
              }
              cleanups.push({ sid, node, key });
            }
          }

          if (cleanups.length === 0) {
            callback(null, { moved: Object.keys(snapshot).length, groupSize: Object.keys(newGroup).length });
            return;
          }

          let done = 0;
          for (const op of cleanups) {
            const remote = { node: op.node, service: 'mem', method: 'del' };
            globalThis.distribution.local.comm.send([{ key: op.key, gid: context.gid }], remote, () => {
              done += 1;
              if (done === cleanups.length) {
                callback(null, { moved: Object.keys(snapshot).length, groupSize: Object.keys(newGroup).length });
              }
            });
          }
        }
      });
    });
  }
  /* For the distributed mem service, the configuration will
          always be a string */
  return {
    get,
    put,
    append,
    del,
    reconf,
  };
}

module.exports = mem;
