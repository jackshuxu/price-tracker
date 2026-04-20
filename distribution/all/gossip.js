// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../types.js").SID} SID
 * @typedef {import("../types.js").Node} Node
 *
 * @typedef {Object} Remote
 * @property {Node} node
 * @property {string} service
 * @property {string} method

 * @typedef {Object} Payload
 * @property {Remote} remote
 * @property {any} message
 * @property {string} mid
 * @property {string} gid
 *
 *
 * @typedef {Object} Gossip
 * @property {(payload: Payload, remote: Remote, callback: Callback) => void} send
 * @property {(perod: number, func: () => void, callback: Callback) => void} at
 * @property {(intervalID: NodeJS.Timeout, callback: Callback) => void} del
 */


/**
 * @param {Config} config
 * @returns {Gossip}
 */
function gossip(config) {
  const context = {};
  context.gid = config.gid || 'all';
  context.subset = config.subset || function(lst) {
    return Math.ceil(Math.log(lst.length));
  };

  function sampleNodes(entries, sampleSize) {
    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    return shuffled.slice(0, sampleSize);
  }

  function normalizeErrorMap(errors) {
    return errors && Object.keys(errors).length > 0 ? errors : null;
  }

  /**
   * @param {Payload} payload
   * @param {Remote} remote
   * @param {Callback} callback
   */
  function send(payload, remote, callback) {
    callback = callback || function () { };

    const normalizedPayload = {
      remote: payload && payload.remote ? payload.remote : remote,
      message: payload && Object.prototype.hasOwnProperty.call(payload, 'message') ? payload.message : payload,
      mid: payload && payload.mid ? payload.mid : globalThis.distribution.util.id.getMID({ payload, remote, gid: context.gid }),
      gid: payload && payload.gid ? payload.gid : context.gid,
    };

    globalThis.distribution.local.groups.get(context.gid, (groupErr, group) => {
      if (groupErr) {
        callback(groupErr);
        return;
      }

      const mySid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);
      const peers = Object.entries(group).filter(([sid]) => sid !== mySid);
      if (peers.length === 0) {
        callback(null, {});
        return;
      }

      const fanout = Math.max(1, Math.min(peers.length, context.subset(peers)));
      const targets = sampleNodes(peers, fanout);

      const errors = {};
      const values = {};
      let count = 0;

      for (const [sid, node] of targets) {
        const target = { node, gid: context.gid, service: 'gossip', method: 'recv' };
        globalThis.distribution.local.comm.send([normalizedPayload], target, (e, v) => {
          if (e) {
            errors[sid] = e;
          } else {
            values[sid] = v;
          }

          count += 1;
          if (count === targets.length) {
            callback(normalizeErrorMap(errors), values);
          }
        });
      }
    });
  }

  /**
   * @param {number} period
   * @param {() => void} func
   * @param {Callback} callback
   */
  function at(period, func, callback) {
    callback = callback || function () { };
    if (typeof period !== 'number' || period <= 0) {
      callback(new Error('gossip.at: period must be a positive number'));
      return;
    }
    if (typeof func !== 'function') {
      callback(new Error('gossip.at: func must be a function'));
      return;
    }

    const intervalID = setInterval(() => {
      try {
        func();
      } catch (e) {
        // Keep periodic task alive even if one execution fails.
      }
    }, period);

    callback(null, intervalID);
  }

  /**
   * @param {NodeJS.Timeout} intervalID
   * @param {Callback} callback
   */
  function del(intervalID, callback) {
    callback = callback || function () { };
    clearInterval(intervalID);
    callback(null, intervalID);
  }

  return {send, at, del};
}

module.exports = gossip;
