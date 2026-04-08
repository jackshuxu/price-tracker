// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").Node} Node
 */

const groups = {};
const { setup: _setup } = require('../all/all.js');

function init() {
  if (!groups['all']) {
    const node = globalThis.distribution.node.config;
    const sid = globalThis.distribution.util.id.getSID(node);
    groups['all'] = { [sid]: node };
  }
}

/**
 * @param {string} name
 * @param {Callback} callback
 */
function get(name, callback) {
  callback = callback || function () { };
  init();

  if (groups[name]) {
    callback(null, { ...groups[name] });
  } else {
    callback(new Error(`groups.js.get: Group ${name} not found!`));
  }
}

/**
 * @param {Config | string} config
 * @param {Object.<string, Node>} group
 * @param {Callback} callback
 */
function put(config, group, callback) {
  callback = callback || function () { };
  init();

  const name = typeof config === 'string' ? config : config.gid;
  groups[name] = { ...group };
  globalThis.distribution[name] = _setup(typeof config === 'object' ? config : { gid: name });
  callback(null, group);
}

/**
 * @param {string} name
 * @param {Callback} callback
 */
function del(name, callback) {
  callback = callback || function () { };
  init();

  if (groups[name]) {
    const removed = groups[name];
    delete groups[name];
    delete globalThis.distribution[name];
    callback(null, removed);
  } else {
    callback(new Error(`groups.js.del: Group ${name} not found!`));
  }
}

/**
 * @param {string} name
 * @param {Node} node
 * @param {Callback} callback
 */
function add(name, node, callback) {
  callback = callback || function () { };
  init();

  if (!groups[name]) {
    return callback(new Error(`groups.js.add: Group ${name} not found!`));
  }
  const sid = globalThis.distribution.util.id.getSID(node);
  groups[name][sid] = node;
  callback(null, groups[name]);
}

/**
 * @param {string} name
 * @param {string} node
 * @param {Callback} callback
 */
function rem(name, node, callback) {
  callback = callback || function () { };
  init();

  if (!groups[name]) {
    return callback(new Error(`groups.js.rem: Group ${name} not found!`));
  }
  delete groups[name][node];
  callback(null, groups[name]);
}

module.exports = { get, put, del, add, rem };
