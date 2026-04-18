#!/usr/bin/env node
/**
 * @typedef {import("./distribution/types.js").Node} Node
 */

/**
 * @param {Node} [config]
 */
function bootstrap(config) {
  let distributionLib = null;
  if (useLibrary) {
    // @ts-ignore Optional dependency for reference implementation.
    const libConfig = Object.assign({}, config || {}, { port: 0 });
    try {
      distributionLib = require('@brown-ds/distribution')(libConfig);
      globalThis._distributionLib = distributionLib;
    } catch (e) {
      distributionLib = null;
    }
  }

  const distribution = {};

  // @ts-ignore This is the first time globalThis.distribution is being initialized, so the object does not have all the necessary properties.
  globalThis.distribution = distribution;
  distribution.util = require('./distribution/util/util.js');

  // @ts-ignore node.server is lazily initialized.
  distribution.node = require('./distribution/local/node.js');
  if (config) {
    distribution.node.config = config;
  }
  distribution.local = require('./distribution/local/local.js');

  const { setup } = require('./distribution/all/all.js');
  distribution.all = setup({ gid: 'all' });

  /* Overrides when missing functionality from previous milestone or extra credit is needed */

  if (distributionLib) {
    distribution.util.serialize = distributionLib.util.serialize;
    distribution.util.deserialize = distributionLib.util.deserialize;
    distribution.util.wire.createRPC = distributionLib.util.wire.createRPC;
    distribution.local.routes = distributionLib.local.routes;
    distribution.local.status.spawn = distributionLib.local.status.spawn;
    distribution.local.status.stop = distributionLib.local.status.stop;
    distribution.local.comm = distributionLib.local.comm;
    distribution.node.start = distributionLib.node.start;
  }

  for (const [key, service] of Object.entries(distribution.local)) {
    distribution.local.routes.put(service, key, () => { });
  }

  return distribution;
}

/*
  This logic determines which implementation of the distribution library to use.
  It can either be:
  1. The reference implementation from the library @brown-ds/distribution
  2. Your own, local implementation
  Set "useLibrary" in package.json to true or false accordingly.
*/
let useLibrary = false;
let debug = false;
try {
  // @ts-ignore JSON import resolved at runtime.
  const pkg = require('./package.json');
  useLibrary = Boolean(pkg.useLibrary);
  debug = Boolean(pkg.debug);
} catch (e) {
  // Default to local implementation when no root package.json exists.
}
let distribution;
if (useLibrary) {
  try {
    // @ts-ignore Optional dependency for reference implementation.
    distribution = require('@brown-ds/distribution');
  } catch (e) {
    distribution = bootstrap;
  }
} else {
  distribution = bootstrap;
}
globalThis.debug = debug ? true : false;

/* The following code is run when distribution.js is invoked directly */
if (require.main === module) {
  globalThis.distribution = distribution();
  globalThis.distribution.node.start(globalThis.distribution.node.config.onStart || (() => { }));
}

module.exports = distribution;