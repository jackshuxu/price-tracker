// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 * @typedef {import("../util/id.js").NID} NID
 */

/**
 * @callback Mapper
 * @param {string} key
 * @param {any} value
 * @returns {object[]}
 */

/**
 * @callback Reducer
 * @param {string} key
 * @param {any[]} value
 * @returns {object}
 */

/**
 * @typedef {Object} MRConfig
 * @property {Mapper} map
 * @property {Reducer} reduce
 * @property {string[]} keys
 * @property {Reducer} [combiner]
 * @property {Function} [partition]
 * @property {number} [rounds]
 *
 * @typedef {Object} Mr
 * @property {(configuration: MRConfig, callback: Callback) => void} exec
 */

/**
 * @param {Config} config
 * @returns {Mr}
 */
function mr(config) {
  const context = {
    gid: config.gid || 'all',
  };

  function runOneRound(gid, configuration, callback) {
    const id = globalThis.distribution.util.id;
    const mrID = id.getID(`${configuration}${Date.now()}`);
    const mrGid = `mr${mrID}`;

    const mrService = {
      mapper: configuration.map,
      reducer: configuration.reduce,

      map: function (sourceGid, serviceId, callback) {
        const self = this;
        globalThis.distribution.local.store.get(
          { key: null, gid: sourceGid }, function (e, localKeys) {
            if (e || !localKeys || !Array.isArray(localKeys) ||
              localKeys.length === 0) {
              return callback(null, []);
            }
            const intermediate = [];
            let cnt = 0;
            for (let i = 0; i < localKeys.length; i++) {
              globalThis.distribution.local.store.get(
                { key: localKeys[i], gid: sourceGid }, function (e, value) {
                  if (!e && value !== undefined) {
                    try {
                      let r = self.mapper(localKeys[i], value);
                      if (!Array.isArray(r)) r = [r];
                      for (let j = 0; j < r.length; j++) {
                        intermediate.push(r[j]);
                      }
                    } catch (err) { }
                  }
                  cnt++;
                  if (cnt === localKeys.length) {
                    self._mapOut = intermediate;
                    callback(null, intermediate);
                  }
                });
            }
          });
      },

      shuffle: function (sourceGid, serviceId, callback) {
        const self = this;
        const reduceGid = serviceId + '_reduce';
        const intermediate = self._mapOut || [];
        if (intermediate.length === 0) return callback(null, null);

        const grouped = {};
        for (let m = 0; m < intermediate.length; m++) {
          const ks = Object.keys(intermediate[m]);
          for (let k = 0; k < ks.length; k++) {
            if (!grouped[ks[k]]) grouped[ks[k]] = [];
            grouped[ks[k]].push(intermediate[m][ks[k]]);
          }
        }

        if (self.combiner) {
          const combineKeys = Object.keys(grouped);
          for (let c = 0; c < combineKeys.length; c++) {
            try {
              const combined = self.combiner(combineKeys[c], grouped[combineKeys[c]]);
              const cval = combined[combineKeys[c]];
              if (cval !== undefined) {
                grouped[combineKeys[c]] = [cval];
              }
            } catch (err) { }
          }
        }

        const gKeys = Object.keys(grouped).sort();

        globalThis.distribution.local.groups.get(
          sourceGid, function (e, nodes) {
            if (e || !nodes) return callback(null, null);
            const nid = globalThis.distribution.util.id;
            const nodeList = Object.values(nodes);
            const nids = [];
            for (let n = 0; n < nodeList.length; n++) {
              nids.push(nid.getNID(nodeList[n]));
            }

            const hashFn = self.partitionFn || nid.naiveHash;

            const ops = [];
            for (let g = 0; g < gKeys.length; g++) {
              const key = gKeys[g];
              const kid = nid.getID(key);
              const chosen = hashFn(kid, nids);
              const target = nodeList[nids.indexOf(chosen)];
              const vals = grouped[key];
              for (let v = 0; v < vals.length; v++) {
                ops.push({ val: vals[v], key: key, node: target });
              }
            }

            if (ops.length === 0) return callback(null, null);

            let done = 0;
            for (let i = 0; i < ops.length; i++) {
              globalThis.distribution.local.comm.send(
                [ops[i].val, { key: ops[i].key, gid: reduceGid }],
                { node: ops[i].node, service: 'store', method: 'append' },
                function () {
                  done++;
                  if (done === ops.length) callback(null, null);
                });
            }
          });
      },

      reduce: function (sourceGid, serviceId, callback) {
        const self = this;
        const reduceGid = serviceId + '_reduce';
        globalThis.distribution.local.store.get(
          { key: null, gid: reduceGid }, function (e, localKeys) {
            if (e || !localKeys || !Array.isArray(localKeys) ||
              localKeys.length === 0) {
              return callback(null, []);
            }
            const results = [];
            let cnt = 0;
            for (let i = 0; i < localKeys.length; i++) {
              const key = localKeys[i];
              globalThis.distribution.local.store.get(
                { key: key, gid: reduceGid }, function (e, values) {
                  if (!e && values) {
                    try {
                      results.push(self.reducer(key, values));
                    } catch (err) { }
                  }
                  cnt++;
                  if (cnt === localKeys.length) {
                    callback(null, results);
                  }
                });
            }
          });
      },

      cleanup: function (serviceId, callback) {
        const reduceGid = serviceId + '_reduce';
        globalThis.distribution.local.store.get(
          { key: null, gid: reduceGid }, function (e, keys) {
            if (e || !keys || !Array.isArray(keys) ||
              keys.length === 0) {
              return callback(null, null);
            }
            let cnt = 0;
            for (let i = 0; i < keys.length; i++) {
              globalThis.distribution.local.store.del(
                { key: keys[i], gid: reduceGid }, function () {
                  cnt++;
                  if (cnt === keys.length) callback(null, null);
                });
            }
          });
      },
    };

    if (configuration.combiner) {
      mrService.combiner = configuration.combiner;
    }
    if (configuration.partition) {
      mrService.partitionFn = configuration.partition;
    }

    globalThis.distribution[gid].routes.put(mrService, mrGid, function (e, v) {
      globalThis.distribution[gid].comm.send(
        [gid, mrGid],
        { service: mrGid, method: 'map' },
        function (errors, mapValues) {
          globalThis.distribution[gid].comm.send(
            [gid, mrGid],
            { service: mrGid, method: 'shuffle' },
            function (errors, shuffleValues) {
              globalThis.distribution[gid].comm.send(
                [gid, mrGid],
                { service: mrGid, method: 'reduce' },
                function (errors, reduceValues) {
                  let allResults = [];
                  if (reduceValues) {
                    const nodeIds = Object.keys(reduceValues);
                    for (let i = 0; i < nodeIds.length; i++) {
                      const nr = reduceValues[nodeIds[i]];
                      if (Array.isArray(nr)) {
                        for (let j = 0; j < nr.length; j++) {
                          allResults.push(nr[j]);
                        }
                      }
                    }
                  }
                  globalThis.distribution[gid].comm.send(
                    [mrGid],
                    { service: mrGid, method: 'cleanup' },
                    function (ce, cv) {
                      globalThis.distribution[gid].routes.rem(
                        mrGid, function (e, v) {
                          callback(null, allResults);
                        });
                    });
                });
            });
        });
    });
  }

  function exec(configuration, callback) {
    const gid = context.gid;

    const totalRounds = configuration.rounds || 1;

    if (totalRounds <= 1) {
      return runOneRound(gid, configuration, callback);
    }

    let currentRound = 0;

    function nextRound(prevResults) {
      currentRound++;
      if (currentRound > totalRounds) {
        return callback(null, prevResults);
      }

      if (currentRound > 1 && prevResults && prevResults.length > 0) {
        let stored = 0;
        for (let i = 0; i < prevResults.length; i++) {
          const keys = Object.keys(prevResults[i]);
          if (keys.length === 0) {
            stored++;
            if (stored === prevResults.length) {
              runOneRound(gid, configuration, function (e, results) {
                nextRound(results);
              });
            }
            continue;
          }
          const key = keys[0];
          const value = prevResults[i][key];
          globalThis.distribution[gid].store.put(
            value, key, function (e, v) {
              stored++;
              if (stored === prevResults.length) {
                runOneRound(gid, configuration, function (e, results) {
                  nextRound(results);
                });
              }
            });
        }
      } else {
        runOneRound(gid, configuration, function (e, results) {
          nextRound(results);
        });
      }
    }

    nextRound(null);
  }

  return { exec };
}

module.exports = mr;
