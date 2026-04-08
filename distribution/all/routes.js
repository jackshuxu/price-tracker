// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 *
 * @typedef {Object} Routes
 * @property {(configuration: string | {service: string, gid?: string}, callback: Callback) => void} get
 * @property {(service: object, name: string, callback: Callback) => void} put
 * @property {(configuration: string, callback: Callback) => void} rem
 */

/**
 * @param {Config} config
 * @returns {Routes}
 */
function routes(config) {
  const context = {};
  context.gid = config.gid || 'all';

  /**
   * @param {string | {service: string, gid?: string}} configuration
   * @param {Callback} [callback]
   */
  function get(configuration, callback) {
    callback = callback || function () { };

    const request = typeof configuration === 'string' ?
      { service: configuration, gid: context.gid } :
      { service: configuration.service, gid: configuration.gid || context.gid };

    const remote = { service: 'routes', method: 'get' };
    globalThis.distribution[context.gid].comm.send([request], remote, (errors, values) => {
      const hasErrors = errors && Object.keys(errors).length > 0;
      const hasValues = values && Object.keys(values).length > 0;
      if (hasErrors && !hasValues) {
        callback(errors);
        return;
      }
      callback(null, values || {});
    });
  }

  /**
   * @param {object} service
   * @param {string} name
   * @param {Callback} [callback]
   */
  function put(service, name, callback) {
    callback = callback || function () { };

    const remote = { service: 'routes', method: 'put' };
    globalThis.distribution[context.gid].comm.send([service, name], remote, callback);
  }

  /**
   * @param {string} configuration
   * @param {Callback} [callback]
   */
  function rem(configuration, callback) {
    callback = callback || function () { };

    const remote = { service: 'routes', method: 'rem' };
    globalThis.distribution[context.gid].comm.send([configuration], remote, callback);
  }

  return { get, put, rem };
}

module.exports = routes;
