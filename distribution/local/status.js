// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 */

/**
 * @param {string} configuration
 * @param {Callback} callback
 */
function get(configuration, callback) {
  callback = callback || function () { };

  if (configuration === 'nid') {
    callback(null, globalThis.distribution.util.id.getNID(globalThis.distribution.node.config));
  } else if (configuration === 'sid') {
    callback(null, globalThis.distribution.util.id.getSID(globalThis.distribution.node.config));
  } else if (configuration === 'counts') {
    callback(null, globalThis.distribution.node.counts || 0);
  } else if (configuration === 'ip') {
    callback(null, globalThis.distribution.node.config.ip);
  } else if (configuration === 'port') {
    callback(null, globalThis.distribution.node.config.port);
  } else if (configuration === 'heapTotal') {
    callback(null, process.memoryUsage().heapTotal);
  } else if (configuration === 'heapUsed') {
    callback(null, process.memoryUsage().heapUsed);
  } else {
    callback(new Error('Error: Status configuration not found'));
  }
}

/**
 * @param {Node} configuration
 * @param {Callback} callback
 */
function spawn(configuration, callback) {
  callback = callback || function () { };

  if (!configuration || !configuration.ip || !configuration.port || configuration.port <= 0) {
    return callback(new Error('Invalid configuration'));
  }

  const createRPC = globalThis.distribution.util.wire.createRPC;
  const path = require('path');

  // Wrap callback to add spawned node to 'all' group first
  const wrappedCb = (e, v) => {
    if (!e) {
      globalThis.distribution.local.groups.add('all', { ip: configuration.ip, port: configuration.port });
    }
    callback(e, v);
  };

  const rpcCb = createRPC(wrappedCb);
  const rpcCbStr = rpcCb.toString();
  const configJson = JSON.stringify({ ip: configuration.ip, port: configuration.port });

  let onStartStr;
  if (configuration.onStart) {
    const rpcOrig = createRPC(configuration.onStart);
    const rpcOrigStr = rpcOrig.toString();
    onStartStr = `(...args) => {
      (${rpcOrigStr})(...args);
      (${rpcCbStr})(null, ${configJson});
    }`;
  } else {
    onStartStr = `(...args) => {
      (${rpcCbStr})(null, ${configJson});
    }`;
  }

  const newOnStart = eval('(' + onStartStr + ')');

  const spawnConfig = {
    ip: configuration.ip,
    port: configuration.port,
    onStart: newOnStart,
  };

  const serialized = globalThis.distribution.util.serialize(spawnConfig);

  const distPath = path.resolve(__dirname, '..', '..', 'distribution.js');
  const child = require('child_process').spawn(
    process.execPath, [distPath, '--config', serialized],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', (err) => {
    callback(new Error('Failed to spawn: ' + err.message), null);
  });
  child.unref();
}

/**
 * @param {Callback} callback
 */
function stop(callback) {
  callback = callback || function () { };
  const server = globalThis.distribution.node.server;
  callback(null, globalThis.distribution.node.config);
  setTimeout(() => {
    if (server) {
      server.close();
    }
  }, 50);
}

module.exports = { get, spawn, stop };
