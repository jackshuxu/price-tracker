// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 * @typedef {import("../types.js").Hasher} Hasher
 */
const log = require('../util/log.js');


/**
 * @param {Function} func
 * @returns {Function} func
 */
function createRPC(func) {
  const id = globalThis.distribution.util.id;
  const rpcId = 'rpc_' + id.getID(func.toString() + Date.now() + Math.random());

  // Register locally
  globalThis.distribution.local.routes.put({ call: (...args) => func(...args) }, rpcId, () => { });

  const nodeConfig = globalThis.distribution.node.config;
  const ip = nodeConfig.ip;
  const port = nodeConfig.port;

  const stubCode = `(...args) => {
    const http = require('node:http');
    const options = {
      hostname: '${ip}',
      port: ${port},
      path: '/local/${rpcId}/call',
      method: 'PUT',
      headers: {'Content-Type': 'application/json'}
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {});
    });
    req.on('error', () => {});
    req.write(globalThis.distribution.util.serialize(args));
    req.end();
  }`;

  return eval('(' + stubCode + ')');
}

/**
 * The toAsync function transforms a synchronous function that returns a value into an asynchronous one,
 * which accepts a callback as its final argument and passes the value to the callback.
 * @param {Function} func
 */
function toAsync(func) {

  // It's the caller's responsibility to provide a callback
  const asyncFunc = (/** @type {any[]} */ ...args) => {
    const callback = args.pop();
    try {
      const result = func(...args);
      return callback(null, result);
    } catch (error) {
      return callback(error);
    }
  };

  /* Overwrite toString to return the original function's code.
   Otherwise, all functions passed through toAsync would have the same id. */
  asyncFunc.toString = () => func.toString();
  return asyncFunc;
}


module.exports = {
  createRPC,
  toAsync,
};