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
 * @property {boolean} [strict]
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

    function toError(err) {
      if (err instanceof Error) {
        return err;
      }
      return new Error(String(err));
    }

    function normalizeStageError(stage, errors) {
      if (!errors) {
        return null;
      }
      if (errors instanceof Error) {
        return errors;
      }
      if (typeof errors === 'object') {
        const keys = Object.keys(errors);
        if (keys.length === 0) {
          return null;
        }
        const first = errors[keys[0]];
        const firstErr = first instanceof Error ? first : new Error(String(first));
        return new Error(`mr ${stage} failed on ${keys.join(', ')}: ${firstErr.message}`);
      }
      return new Error(`mr ${stage} failed: ${String(errors)}`);
    }

    function cleanupAndReturn(error, result) {
      globalThis.distribution[gid].comm.send(
        [mrGid],
        { service: mrGid, method: 'cleanup' },
        function () {
          globalThis.distribution[gid].routes.rem(
            mrGid,
            function () {
              callback(error, result);
            },
          );
        },
      );
    }

    const mrService = {
      mapper: configuration.map,
      reducer: configuration.reduce,
      constants: configuration.constants || {},
      strict: Boolean(configuration.strict),
      outputGid: typeof configuration.outputGid === 'string' ? configuration.outputGid : null,
      batchSize: Math.max(0, Number(configuration.batchSize || 0)),
      shuffleConcurrency: Math.max(1, Number(configuration.shuffleConcurrency || 64)),
      _fatalError: null,
      _errorSummary: {
        map: { count: 0, samples: [] },
        combine: { count: 0, samples: [] },
        reduce: { count: 0, samples: [] },
      },
      _recordError: function (stage, err, context) {
        const bucket = this._errorSummary[stage];
        const normalized = toError(err);
        const message = context ? `${context}: ${normalized.message}` : normalized.message;

        bucket.count += 1;
        if (bucket.samples.length < 5) {
          bucket.samples.push(message);
        }
        if (bucket.count <= 3) {
          console.error(`[mr.${stage}] ${message}`);
        }
        if (this.strict && !this._fatalError) {
          this._fatalError = new Error(`mr.${stage} ${message}`);
        }
      },
      _hasErrors: function () {
        return this._errorSummary.map.count > 0 ||
          this._errorSummary.combine.count > 0 ||
          this._errorSummary.reduce.count > 0;
      },

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
                    } catch (err) {
                      self._recordError('map', err, `key=${String(localKeys[i])}`);
                    }
                  }
                  cnt++;
                  if (cnt === localKeys.length) {
                    self._mapOut = intermediate;
                    if (self.strict && self._fatalError) {
                      callback(self._fatalError);
                      return;
                    }
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
            } catch (err) {
              self._recordError('combine', err, `key=${String(combineKeys[c])}`);
            }
          }
        }

        if (self.strict && self._fatalError) {
          callback(self._fatalError);
          return;
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
                const emptySummary = { gid: outputGid, written: 0, reducedKeys: 0 };
                if (self._hasErrors()) {
                  emptySummary.errors = self._errorSummary;
                }
                return callback(self.strict && self._fatalError ? self._fatalError : null, emptySummary);
              }
              return callback(self.strict && self._fatalError ? self._fatalError : null, []);
            }

            const results = [];
            let written = 0;
            let reducedKeys = 0;
            let cnt = 0;

            function finishOne() {
              cnt++;
              if (cnt === localKeys.length) {
                if (self.strict && self._fatalError) {
                  callback(self._fatalError);
                  return;
                }
                if (outputGid) {
                  const summary = { gid: outputGid, written, reducedKeys };
                  if (self._hasErrors()) {
                    summary.errors = self._errorSummary;
                  }
                  callback(null, summary);
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
                        self._recordError('reduce', err, `decode-key=${String(key)}`);
                        reduceKey = key;
                      }
                    }
                    reduced = self.reducer(reduceKey, values, self.constants);
                  } catch (err) {
                    self._recordError('reduce', err, `key=${String(key)}`);
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

    globalThis.distribution[gid].routes.put(mrService, mrGid, function (e) {
      if (e) {
        callback(e);
        return;
      }

      globalThis.distribution[gid].comm.send(
        [gid, mrGid],
        { service: mrGid, method: 'map' },
        function (mapErrors) {
          const mapStageError = configuration.strict ? normalizeStageError('map', mapErrors) : null;
          if (mapStageError) {
            cleanupAndReturn(mapStageError);
            return;
          }

          globalThis.distribution[gid].comm.send(
            [gid, mrGid],
            { service: mrGid, method: 'shuffle' },
            function (shuffleErrors) {
              const shuffleStageError = configuration.strict ? normalizeStageError('shuffle', shuffleErrors) : null;
              if (shuffleStageError) {
                cleanupAndReturn(shuffleStageError);
                return;
              }

              globalThis.distribution[gid].comm.send(
                [gid, mrGid],
                { service: mrGid, method: 'reduce' },
                function (reduceErrors, reduceValues) {
                  const reduceStageError = configuration.strict ? normalizeStageError('reduce', reduceErrors) : null;
                  if (reduceStageError) {
                    cleanupAndReturn(reduceStageError);
                    return;
                  }

                  let finalResult = [];
                  if (configuration.outputGid) {
                    const summary = {
                      gid: configuration.outputGid,
                      written: 0,
                      reducedKeys: 0,
                      nodes: 0,
                    };

                    const mergedErrors = {
                      map: { count: 0, samples: [] },
                      combine: { count: 0, samples: [] },
                      reduce: { count: 0, samples: [] },
                    };
                    let hasNodeErrors = false;

                    if (reduceValues) {
                      const nodeIds = Object.keys(reduceValues);
                      summary.nodes = nodeIds.length;
                      for (let i = 0; i < nodeIds.length; i++) {
                        const nodeResult = reduceValues[nodeIds[i]];
                        if (!nodeResult || typeof nodeResult !== 'object') {
                          continue;
                        }

                        summary.written += Number(nodeResult.written) || 0;
                        summary.reducedKeys += Number(nodeResult.reducedKeys) || 0;

                        if (nodeResult.errors && typeof nodeResult.errors === 'object') {
                          const stages = ['map', 'combine', 'reduce'];
                          for (let s = 0; s < stages.length; s++) {
                            const stage = stages[s];
                            const stageError = nodeResult.errors[stage];
                            if (!stageError || typeof stageError !== 'object') {
                              continue;
                            }
                            hasNodeErrors = true;
                            mergedErrors[stage].count += Number(stageError.count) || 0;
                            const samples = Array.isArray(stageError.samples) ? stageError.samples : [];
                            for (let j = 0; j < samples.length; j++) {
                              if (mergedErrors[stage].samples.length >= 10) {
                                break;
                              }
                              mergedErrors[stage].samples.push(String(samples[j]));
                            }
                          }
                        }
                      }
                    }

                    if (hasNodeErrors) {
                      summary.errors = mergedErrors;
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

                  cleanupAndReturn(null, finalResult);
                },
              );
            },
          );
        },
      );
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
                if (e) {
                  callback(e);
                  return;
                }
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
                  if (e) {
                    callback(e);
                    return;
                  }
                  nextRound(results);
                });
              }
            });
        }
      } else {
        runOneRound(gid, configuration, function (e, results) {
          if (e) {
            callback(e);
            return;
          }
          nextRound(results);
        });
      }
    }

    nextRound(null);
  }

  return { exec };
}

module.exports = mr;
