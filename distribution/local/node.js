// @ts-check
/**
 * @typedef {import("../types.js").Node} Node
 * @typedef {import("../types.js").Callback} Callback
 */
const http = require('node:http');
const log = require('../util/log.js');

/**
 * @param {string[]} argv
 * @returns {Object.<string, string | boolean>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      continue;
    }

    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
      continue;
    }

    const key = token.slice(1);
    const next = argv[i + 1];
    if (!next || next.startsWith('-')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * @returns {Node}
 */
function setNodeConfig() {
  const args = parseArgs(process.argv);

  let maybeIp; let maybePort; let maybeOnStart;
  if (typeof args.ip === 'string') {
    maybeIp = args.ip;
  }
  if (typeof args.port === 'string' || typeof args.port === 'number') {
    maybePort = parseInt(String(args.port), 10);
  }

  if (args.help === true || args.h === true) {
    console.log('Node usage:');
    console.log('  --ip <ip address>      The ip address to bind the node to');
    console.log('  --port <port>          The port to bind the node to');
    console.log('  --config <config>      The serialized config string');
    process.exit(0);
  }

  const configIdx = process.argv.indexOf('--config');
  if (configIdx !== -1 && configIdx + 1 < process.argv.length) {
    const configStr = process.argv[configIdx + 1];
    let config = undefined;
    try {
      let deserialize = null;
      try {
        deserialize = globalThis._distributionLib.util.deserialize;
      } catch (e) { }
      if (!deserialize) {
        try {
          deserialize = globalThis.distribution.util.deserialize;
        } catch (e) { }
      }
      if (deserialize) {
        config = deserialize(configStr);
      }
    } catch (error) {
      try {
        config = JSON.parse(configStr);
      } catch {
        console.error('Cannot deserialize config string');
        process.exit(1);
      }
    }

    if (typeof config?.ip === 'string') {
      maybeIp = config?.ip;
    }
    if (typeof config?.port === 'number') {
      maybePort = config?.port;
    }
    if (typeof config?.onStart === 'function') {
      maybeOnStart = config?.onStart;
    }
  }

  // Default values for config
  maybeIp = maybeIp ?? '127.0.0.1';
  maybePort = maybePort ?? 1234;

  return {
    ip: maybeIp,
    port: maybePort,
    onStart: maybeOnStart,
  };
}
/*
    The start function will be called to start your node.
    It will take a callback as an argument.
    After your node has booted, you should call the callback.
*/


/**
 * @param {(err?: Error | null) => void} callback
 * @returns {void}
 */
function start(callback) {
  const server = http.createServer((req, res) => {
    /* Your server will be listening for PUT requests. */
    if (req.method !== 'PUT') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end(globalThis.distribution.util.serialize(new Error('node.start only accepts PUT requests...')));
      return;
    }

    /*
      The path of the http request will determine the service to be used.
      The url will have the form: http://node_ip:node_port/service/method
    */
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch (parseError) {
      const resp = globalThis.distribution.util.serialize([new Error('Invalid request URL'), null]);
      res.end(resp);
      return;
    }

    const lists = parsedUrl.pathname.split('/');
    const gid = lists[1] || 'local';
    const service = lists[2];
    const method = lists[3];

    globalThis.distribution.node.counts = (globalThis.distribution.node.counts || 0) + 1;

    /*
      A common pattern in handling HTTP requests in Node.js is to have a
      subroutine that collects all the data chunks belonging to the same
      request. These chunks are aggregated into a body variable.

      When the req.on('end') event is emitted, it signifies that all data from
      the request has been received. Typically, this data is in the form of a
      string. To work with this data in a structured format, it is often parsed
      into a JSON object using JSON.parse(body), provided the data is in JSON
      format.

      Our nodes expect data in JSON format.
    */
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {

      /*
        Here, you can handle the service requests.
        Use the local routes service to get the service you need to call.
        You need to call the service with the method and arguments provided in the request.
        Then, you need to serialize the result and send it back to the caller.
      */

      let args = [];
      try {
        if (body.length > 0) {
          args = globalThis.distribution.util.deserialize(body);
        }
      } catch (error) {
        const resp = globalThis.distribution.util.serialize([new Error("Invalid JSON"), null]);
        res.end(resp);
        return;
      }

      const serviceCallback = (e, v) => {
        let responseBuffer;
        try {
          responseBuffer = globalThis.distribution.util.serialize([e, v]);
        } catch (serializationError) {
          console.error("Node.start:Serialization failed!");
          const safeError = new Error(e ? e.message : "Internal Serialization Error");
          responseBuffer = globalThis.distribution.util.serialize([safeError, null]);
        }
        res.end(responseBuffer);
      };

      globalThis.distribution.local.routes.get({ service, gid }, (err, serviceObj) => {
        if (err) {
          serviceCallback(err, null);
        } else if (!serviceObj[method]) {
          serviceCallback(new Error(`Method ${method} not found`), null);
        } else {
          try {
            serviceObj[method](...args, serviceCallback);
          } catch (runtimeErr) {
            serviceCallback(new Error(runtimeErr.message), null);
          }
        }
      });
    });
  });

  /*
    Your server will be listening on the port and ip specified in the config
    You'll be calling the `callback` callback when your server has successfully
    started.

    At some point, we'll be adding the ability to stop a node
    remotely through the service interface.
  */

  // Important: allow tests to access server
  globalThis.distribution.node.server = server;
  const config = globalThis.distribution.node.config;

  server.once('listening', () => {
    callback(null);
  });

  server.once('error', (error) => {
    callback(error);
  });

  server.listen(config.port, config.ip);
}


module.exports = { start, config: setNodeConfig(), counts: 0 };