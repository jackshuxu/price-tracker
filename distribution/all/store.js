// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").Hasher} Hasher
 * @typedef {import("../types.js").Node} Node
 */


/**
 * @typedef {Object} StoreConfig
 * @property {string | null} key
 * @property {string} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */

/**
 * @param {Config} config
 */
function store(config) {
  const context = {
    gid: config.gid || 'all',
    hash: config.hash || globalThis.distribution.util.id.naiveHash,
    subset: config.subset,
  };

  const id = require('../util/id.js');

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
   */
  function hashToNode(kid, nodes) {
    const nodeEntries = Object.values(nodes);
    const nids = nodeEntries.map((node) => id.getNID(node));
    const chosenNid = context.hash(kid, nids);
    const idx = nids.indexOf(chosenNid);
    return nodeEntries[idx];
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
          const remote = { node: nodes[sid], service: 'store', method: 'get' };
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

      const node = hashToNode(kid, nodes);
      globalThis.distribution.local.comm.send([{ key, gid: effectiveGid }], { node, service: 'store', method: 'get' }, callback);
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
        return callback(new Error('all.store.put: No nodes in group'));
      }

      const node = hashToNode(kid, nodes);
      globalThis.distribution.local.comm.send([state, { key, gid: effectiveGid }], { node, service: 'store', method: 'put' }, callback);
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
        return callback(new Error('all.store.append: No nodes in group'));
      }

      const node = hashToNode(kid, nodes);
      globalThis.distribution.local.comm.send([state, { key, gid: effectiveGid }], { node, service: 'store', method: 'append' }, callback);
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
        return callback(new Error('all.store.del: No nodes in group'));
      }

      const node = hashToNode(kid, nodes);
      globalThis.distribution.local.comm.send([{ key, gid: effectiveGid }], { node, service: 'store', method: 'del' }, callback);
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
      callback(new Error('store.reconf: new group is empty'));
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
        if (keys.length === 0) {
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
            if (writes.length === 0) {
              callback(null, { moved: 0, groupSize: Object.keys(newGroup).length });
              return;
            }

            let writeDone = 0;
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
            const remote = { node: op.node, service: 'store', method: 'del' };
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

  /* For the distributed store service, the configuration will
          always be a string */
  return { get, put, append, del, reconf };
}

module.exports = store;
