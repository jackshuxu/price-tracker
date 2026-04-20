// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 */

/**
 * NOTE: This Target is slightly different from local.all.Target
 * @typedef {Object} Target
 * @property {string} service
 * @property {string} method
 * @property {string} [gid]
 *
 * @typedef {Object} Comm
 * @property {(message: any[], configuration: Target, callback: Callback) => void} send
 */

/**
 * @param {Config} config
 * @returns {Comm}
 */
function comm(config) {
  const context = {};
  context.gid = config.gid || 'all';

  /**
   * @param {any[]} message
   * @param {Target} configuration
   * @param {Callback} callback
   */
  function send(message, configuration, callback) {
    callback = callback || function () { };

    globalThis.distribution.local.groups.get(context.gid, (e, group) => {
      if (e) {
        callback(new Error('all.comm.comm.send: Group not found: ' + context.gid));
        return;
      }

      const nodes = Object.entries(group);
      if (nodes.length === 0) {
        callback(new Error('all.comm.comm.send: Empty group'));
        return;
      }

      const errors = {};
      const values = {};
      let count = 0;

      for (const [sid, node] of nodes) {
        const remote = {
          node: node,
          service: configuration.service,
          method: configuration.method,
        };

        globalThis.distribution.local.comm.send(message, remote, (e, v) => {
          if (e) {
            errors[sid] = e;
          } else {
            values[sid] = v;
          }

          count++;
          //console.log('DEBUG: all.comm.comm.send: count', count);
          if (count === nodes.length) {
            callback(Object.keys(errors).length > 0 ? errors : null, values);
          }
        });
      }
    });
  }

  return { send };
}

module.exports = comm;
