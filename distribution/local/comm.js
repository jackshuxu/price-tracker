// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Node} Node
 */

const http = require('node:http');

const sharedAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 256,
  maxFreeSockets: 64,
});

/**
 * @typedef {Object} Target
 * @property {string} service
 * @property {string} method
 * @property {Node} node
 * @property {string} [gid]
 */

/**
 * @param {Array<any>} message
 * @param {Target} remote
 * @param {(error: Error, value?: any) => void} callback
 * @returns {void}
 */
function send(message, remote, callback) {
  callback = callback || function () { };

  let callbackInvoked = false;
  const safeCallback = (e, v) => {
    if (callbackInvoked) return;
    callbackInvoked = true;
    clearTimeout(timeoutId);
    callback(e, v);
  };

  const options = {
    hostname: remote.node.ip,
    port: remote.node.port,
    path: `/${remote.gid || 'local'}/${remote.service}/${remote.method}`,
    method: 'PUT',
    agent: sharedAgent,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const timeoutRaw = Number(process.env.DISTRIBUTION_COMM_TIMEOUT_MS || 15000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 15000;

  const req = http.request(options, (res) => {
    let body = '';

    res.on('data', (chunk) => {
      body += chunk;
    });

    res.on('end', () => {
      try {
        const [e, v] = globalThis.distribution.util.deserialize(body);
        safeCallback(e, v);
      } catch (error) {
        safeCallback(new Error('Failed to deserialize response: ' + error.message));
      }
    });
  });

  const timeoutId = setTimeout(() => {
    req.destroy(new Error('Request timed out'));
  }, timeoutMs);

  req.on('error', (error) => {
    const cleanError = new Error(error.message);
    // @ts-ignore
    cleanError.code = error.code;
    safeCallback(cleanError);
  });

  try {
    req.write(globalThis.distribution.util.serialize(message));
    req.end();
  } catch (error) {
    safeCallback(new Error('Failed to serialize message: ' + error.message));
  }
}

module.exports = { send };