// @ts-check
/**
 * @typedef {import("../types").Callback} Callback
 * @typedef {import("../types").Node} Node
 *
 * @typedef {Object} Payload
 * @property {{service: string, method: string, node: Node}} remote
 * @property {any} message
 * @property {string} mid
 * @property {string} gid
 */

const N = 10;
const seen = new Set();
const order = [];

function remember(mid) {
  if (seen.has(mid)) {
    return false;
  }
  seen.add(mid);
  order.push(mid);
  if (order.length > N) {
    const evicted = order.shift();
    if (evicted) {
      seen.delete(evicted);
    }
  }
  return true;
}

function asArgs(message) {
  return Array.isArray(message) ? message : [message];
}


/**
 * @param {Payload} payload
 * @param {Callback} callback
 */
function recv(payload, callback) {
  callback = callback || function () { };

  if (!payload || !payload.remote || !payload.remote.service || !payload.remote.method) {
    callback(new Error('gossip.recv: invalid payload'));
    return;
  }

  const gid = payload.gid || 'all';
  const mid = payload.mid || globalThis.distribution.util.id.getMID(payload);

  if (!remember(mid)) {
    callback(null, { mid, duplicate: true });
    return;
  }

  globalThis.distribution.local.routes.get(
    { service: payload.remote.service, gid },
    (routeErr, serviceObj) => {
      if (routeErr) {
        callback(routeErr);
        return;
      }

      const fn = serviceObj[payload.remote.method];
      if (typeof fn !== 'function') {
        callback(new Error(`gossip.recv: method ${payload.remote.method} not found`));
        return;
      }

      const args = asArgs(payload.message);
      fn(...args, (serviceErr, serviceValue) => {
        if (serviceErr) {
          callback(serviceErr);
          return;
        }

        // Best-effort forwarding; duplicate suppression prevents cycles.
        if (globalThis.distribution[gid] && globalThis.distribution[gid].gossip) {
          globalThis.distribution[gid].gossip.send(payload, payload.remote, () => {
            callback(null, { mid, duplicate: false, value: serviceValue });
          });
          return;
        }

        callback(null, { mid, duplicate: false, value: serviceValue });
      });
    },
  );
}

module.exports = {recv};
