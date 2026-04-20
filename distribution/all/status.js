// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../util/id.js").Node} Node
 *
 * @typedef {Object} Status
 * @property {(configuration: string, callback: Callback) => void} get
 * @property {(configuration: Node, callback: Callback) => void} spawn
 * @property {(callback: Callback) => void} stop
 */

/**
 * @param {Config} config
 * @returns {Status}
 */
function status(config) {
  const context = {};
  context.gid = config.gid || 'all';

  function normalizeError(err) {
    return err && Object.keys(err).length > 0 ? err : null;
  }

  /**
   * @param {string} configuration
   * @param {Callback} callback
   */
  function get(configuration, callback) {
    const remote = { service: 'status', method: 'get' };
    globalThis.distribution[context.gid].comm.send([configuration], remote, (e, v) => {
      if (configuration === 'heapTotal' || configuration === 'heapUsed') {
        let tmp = 0;
        for (const val of Object.values(v)) {
          tmp += val;
        }
        callback(e, tmp);
      } else if (configuration === 'nid' || configuration === 'sid') {
        callback(e, Object.values(v));
      } else {
        callback(e, v);
      }
    });
  }

  /**
   * @param {Node} configuration
   * @param {Callback} callback
   */
  function spawn(configuration, callback) {
    callback = callback || function () { };

    if (!configuration || !configuration.ip || !configuration.port) {
      callback(new Error('status.spawn: invalid node configuration'));
      return;
    }

    const node = { ip: configuration.ip, port: configuration.port };
    const sid = globalThis.distribution.util.id.getSID(node);

    globalThis.distribution.local.status.spawn(node, (spawnErr, spawnValue) => {
      if (spawnErr) {
        callback(spawnErr);
        return;
      }

      globalThis.distribution.local.groups.get(context.gid, (groupErr, group) => {
        if (groupErr) {
          callback(groupErr);
          return;
        }

        const updatedGroup = { ...group, [sid]: node };

        // Keep local view updated before broadcast; this also initializes gid service handle.
        globalThis.distribution.local.groups.put({ gid: context.gid }, updatedGroup, (localPutErr) => {
          if (localPutErr) {
            callback(localPutErr);
            return;
          }

          // Broadcast full group map so all peers converge to the same membership view.
          globalThis.distribution[context.gid].groups.put({ gid: context.gid }, updatedGroup, (putErr, putValues) => {
            const normalizedErr = normalizeError(putErr);
            if (normalizedErr) {
              callback(normalizedErr, putValues);
              return;
            }
            callback(null, {
              node,
              sid,
              spawn: spawnValue,
              groupSize: Object.keys(updatedGroup).length,
            });
          });
        });
      });
    });
  }

  /**
   * @param {Callback} callback
   */
  function stop(callback) {
    const myselfsid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);

    globalThis.distribution.local.groups.get(context.gid, (e, group) => {
      if (e) {
        callback(e);
        return;
      }

      const nodes = Object.entries(group).filter(([sid]) => sid !== myselfsid);
      if (nodes.length === 0) {
        callback(null, {});
        return;
      }

      const errors = {};
      const values = {};
      let count = 0;

      for (const [sid, node] of nodes) {
        const r = { node, gid: context.gid, service: 'status', method: 'stop' };
        globalThis.distribution.local.comm.send([], r, (e, v) => {
          if (e) {
            errors[sid] = e;
          } else {
            values[sid] = v;
          }

          count++;

          if (count === nodes.length) {
            callback(errors, values);
          }
        });
      }
    });
  }

  return { get, stop, spawn };
}

module.exports = status;
