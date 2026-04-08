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
 * @property {object} [constants]
 * @property {string} [outputGid]
 * @property {number} [batchSize]
 * @property {number} [shuffleConcurrency]
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
      constants: configuration.constants || {},
      outputGid: typeof configuration.outputGid === 'string' ? configuration.outputGid : null,
      batchSize: Math.max(0, Number(configuration.batchSize || 0)),
      shuffleConcurrency: Math.max(1, Number(configuration.shuffleConcurrency || 64)),

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
                      let r = self.mapper(localKeys[i], value, self.constants);
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

        function runWithLimit(items, limit, worker, done) {
          if (!items || items.length === 0) {
            done();
            return;
          }

          const safeLimit = Math.max(1, Number(limit) || 1);
          let cursor = 0;
          let inFlight = 0;
          let completed = 0;

          function launch() {
            while (inFlight < safeLimit && cursor < items.length) {
              const item = items[cursor++];
              inFlight += 1;
              worker(item, function () {
                inFlight -= 1;
                completed += 1;
                if (completed === items.length) {
                  done();
                } else {
                  launch();
                }
              });
            }
          }

          launch();
        }

        const grouped = {};
        for (let m = 0; m < intermediate.length; m++) {
          const ks = Object.keys(intermediate[m]);
          for (let k = 0; k < ks.length; k++) {
            const rawKey = ks[k];
            const encodedKey = typeof rawKey === 'string' ?
              `s:${rawKey}` :
              `j:${globalThis.distribution.util.serialize(rawKey)}`;
            if (!grouped[encodedKey]) grouped[encodedKey] = [];
            grouped[encodedKey].push(intermediate[m][rawKey]);
          }
        }

        if (self.combiner) {
          const combineKeys = Object.keys(grouped);
          for (let c = 0; c < combineKeys.length; c++) {
            try {
              const combined = self.combiner(combineKeys[c], grouped[combineKeys[c]], self.constants);
              const cval = combined && typeof combined === 'object' &&
                Object.prototype.hasOwnProperty.call(combined, combineKeys[c]) ?
                combined[combineKeys[c]] : combined;
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

            const shuffleConcurrency = Math.max(1, Number(self.shuffleConcurrency || 64));
            const batchSize = Math.max(0, Number(self.batchSize || 0));

            if (batchSize > 1) {
              const byNode = {};
              for (let i = 0; i < ops.length; i++) {
                const nodeId = nid.getNID(ops[i].node);
                if (!byNode[nodeId]) {
                  byNode[nodeId] = { node: ops[i].node, entries: [] };
                }
                byNode[nodeId].entries.push({ key: ops[i].key, value: ops[i].val });
              }

              const batchTasks = [];
              const buckets = Object.values(byNode);
              for (let i = 0; i < buckets.length; i++) {
                const entries = buckets[i].entries;
                for (let j = 0; j < entries.length; j += batchSize) {
                  batchTasks.push({
                    node: buckets[i].node,
                    entries: entries.slice(j, j + batchSize),
                  });
                }
              }

              runWithLimit(batchTasks, shuffleConcurrency, function (task, nextTask) {
                globalThis.distribution.local.comm.send(
                  [task.entries, { gid: reduceGid }],
                  { node: task.node, service: 'store', method: 'batchAppend' },
                  function (batchErr) {
                    if (!batchErr) {
                      nextTask();
                      return;
                    }

                    // Fall back to append when a remote node does not expose batchAppend.
                    runWithLimit(task.entries, 16, function (entry, nextEntry) {
                      globalThis.distribution.local.comm.send(
                        [entry.value, { key: entry.key, gid: reduceGid }],
                        { node: task.node, service: 'store', method: 'append' },
                        function () {
                          nextEntry();
                        },
                      );
                    }, function () {
                      nextTask();
                    });
                  },
                );
              }, function () {
                callback(null, null);
              });
              return;
            }

            const appendTasks = ops.map((op) => ({ node: op.node, key: op.key, value: op.val }));
            runWithLimit(appendTasks, shuffleConcurrency, function (task, nextTask) {
              globalThis.distribution.local.comm.send(
                [task.value, { key: task.key, gid: reduceGid }],
                { node: task.node, service: 'store', method: 'append' },
                function () {
                  nextTask();
                },
              );
            }, function () {
              callback(null, null);
            });
          });
      },

      reduce: function (sourceGid, serviceId, callback) {
        const self = this;
        const reduceGid = serviceId + '_reduce';
        const outputGid = self.outputGid;
        globalThis.distribution.local.store.get(
          { key: null, gid: reduceGid }, function (e, localKeys) {
            if (e || !localKeys || !Array.isArray(localKeys) ||
              localKeys.length === 0) {
              if (outputGid) {
                return callback(null, { gid: outputGid, written: 0, reducedKeys: 0 });
              }
              return callback(null, []);
            }

            const results = [];
            let written = 0;
            let reducedKeys = 0;
            let cnt = 0;

            function finishOne() {
              cnt++;
              if (cnt === localKeys.length) {
                if (outputGid) {
                  callback(null, { gid: outputGid, written, reducedKeys });
                } else {
                  callback(null, results);
                }
              }
            }

            for (let i = 0; i < localKeys.length; i++) {
              const key = localKeys[i];
              globalThis.distribution.local.store.get(
                { key: key, gid: reduceGid }, function (e, values) {
                  if (e || !values) {
                    finishOne();
                    return;
                  }

                  let reduced;
                  try {
                    let reduceKey = key;
                    if (typeof key === 'string' && key.startsWith('s:')) {
                      reduceKey = key.slice(2);
                    } else if (typeof key === 'string' && key.startsWith('j:')) {
                      try {
                        reduceKey = globalThis.distribution.util.deserialize(key.slice(2));
                      } catch (err) {
                        reduceKey = key;
                      }
                    }
                    reduced = self.reducer(reduceKey, values, self.constants);
                  } catch (err) {
                    finishOne();
                    return;
                  }

                  reducedKeys += 1;

                  if (!outputGid) {
                    results.push(reduced);
                    finishOne();
                    return;
                  }

                  if (!reduced || typeof reduced !== 'object') {
                    finishOne();
                    return;
                  }

                  const entries = Object.entries(reduced);
                  if (entries.length === 0) {
                    finishOne();
                    return;
                  }

                  let pendingWrites = entries.length;
                  for (let j = 0; j < entries.length; j++) {
                    const outKey = String(entries[j][0]);
                    const outValue = entries[j][1];
                    globalThis.distribution.local.store.put(
                      outValue,
                      { key: outKey, gid: outputGid },
                      function () {
                        written += 1;
                        pendingWrites -= 1;
                        if (pendingWrites === 0) {
                          finishOne();
                        }
                      },
                    );
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
                  let finalResult = [];
                  if (configuration.outputGid) {
                    const summary = {
                      gid: configuration.outputGid,
                      written: 0,
                      reducedKeys: 0,
                      nodes: 0,
                    };
                    if (reduceValues) {
                      const nodeIds = Object.keys(reduceValues);
                      summary.nodes = nodeIds.length;
                      for (let i = 0; i < nodeIds.length; i++) {
                        const nodeResult = reduceValues[nodeIds[i]];
                        if (nodeResult && typeof nodeResult === 'object') {
                          summary.written += Number(nodeResult.written) || 0;
                          summary.reducedKeys += Number(nodeResult.reducedKeys) || 0;
                        }
                      }
                    }
                    finalResult = summary;
                  } else if (reduceValues) {
                    const nodeIds = Object.keys(reduceValues);
                    for (let i = 0; i < nodeIds.length; i++) {
                      const nr = reduceValues[nodeIds[i]];
                      if (Array.isArray(nr)) {
                        for (let j = 0; j < nr.length; j++) {
                          finalResult.push(nr[j]);
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
                          callback(null, finalResult);
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

      if (currentRound > 1 && Array.isArray(prevResults) && prevResults.length > 0) {
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
