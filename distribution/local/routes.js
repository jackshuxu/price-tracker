/**
 * @typedef {import("../types").Callback} Callback
 * @typedef {string} ServiceName
 */

const routes = {};

/**
 * @param {ServiceName | {service: ServiceName, gid?: string}} configuration
 * @param {Callback} callback
 * @returns {void}
 */
function get(configuration, callback) {
  callback = callback || function () { };

  let name, gid;
  if (typeof configuration === 'object') {
    name = configuration.service;
    gid = configuration.gid || 'local';
  } else {
    name = configuration;
    gid = 'local';
  }

  if (gid !== 'local' && globalThis.distribution[gid] && globalThis.distribution[gid][name]) {
    callback(null, globalThis.distribution[gid][name]);
  } else if (routes[name]) {
    callback(null, routes[name]);
  } else {
    callback(new Error('routes.get: invalid configuration'));
  }
}

/**
 * @param {object} service
 * @param {string} configuration
 * @param {Callback} callback
 * @returns {void}
 */
function put(service, configuration, callback) {
  callback = callback || function () { };
  routes[configuration] = service;
  callback(null, configuration);
}

/**
 * @param {string} configuration
 * @param {Callback} callback
 */
function rem(configuration, callback) {
  callback = callback || function () { };
  if (routes[configuration]) {
    let removed = routes[configuration];
    delete routes[configuration];
    callback(null, removed);
  } else {
    callback(new Error('routes.rem: invalid configuration'));
  }
}

module.exports = { get, put, rem };
