// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 *
 * @typedef {Object} StoreConfig
 * @property {string | null} key
 * @property {string | null} gid
 *
 * @typedef {StoreConfig | string | null} SimpleConfig
 */

const id = require('../util/id.js');

const memory = {};

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

  if (!memory[gid]) {
    memory[gid] = {};
  }

  memory[gid][key] = state;
  callback(null, state);
}

/**
 * @param {any} state
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function append(state, configuration, callback) {
  let {key, gid} = helper(configuration);

  if (!key) {
    key = id.getID(state);
  }

  if (!memory[gid]) {
    memory[gid] = {};
  }

  if (!memory[gid][key]) {
    memory[gid][key] = [state];
  } else if (Array.isArray(memory[gid][key])) {
    memory[gid][key].push(state);
  } else {
    memory[gid][key] = [memory[gid][key], state];
  }

  callback(null, memory[gid][key]);
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  let { key, gid } = helper(configuration);

  if (!memory[gid]) {
    if (key === null) {
      return callback(null, []);
    }
    return callback(new Error('local.mem.get: Group not found'));
  }

  if (key === null) {
    return callback(null, Object.keys(memory[gid]));
  }

  if (!(key in memory[gid])) {
    return callback(new Error('local.mem.get: Key not found'));
  }

  callback(null, memory[gid][key]);
}

/**
 * @param {SimpleConfig} configuration
 * @param {Callback} callback
 */
function del(configuration, callback) {
  let { key, gid } = helper(configuration);

  if (!memory[gid] || !(key in memory[gid])) {
    return callback(new Error('local.mem.del: Key not found'));
  }

  const value = memory[gid][key];
  delete memory[gid][key];
  callback(null, value);
}

module.exports = { put, get, del, append };
