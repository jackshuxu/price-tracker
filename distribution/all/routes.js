// @ts-check
/**
 * @typedef {import("../types.js").Callback} Callback
 * @typedef {import("../types.js").Config} Config
 *
 * @typedef {Object} Routes
 * @property {(configuration: string | {service: string, gid?: string}, callback: Callback) => void} get
 * @property {(service: object, name: string, callback: Callback) => void} put
 * @property {(configuration: string, callback: Callback) => void} rem
 */

/**
 * @param {Config} config
 * @returns {Routes}
 */
function routes(config) {
  const context = {};
  context.gid = config.gid || 'all';

  const ttlRaw = Number(process.env.DISTRIBUTION_ROUTES_CACHE_MS || 1000);
  const cacheTtlMs = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 1000;
  const routeCache = new Map();

  function cacheKey(gid, service) {
    return `${gid}:${service}`;
  }

  function getCached(gid, service) {
    const key = cacheKey(gid, service);
    const hit = routeCache.get(key);
    if (!hit) {
      return null;
    }
    if (hit.expiresAt <= Date.now()) {
      routeCache.delete(key);
      return null;
    }
    return hit.value;
  }

  function setCached(gid, service, value) {
    routeCache.set(cacheKey(gid, service), {
      value,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }

  function invalidateCache(gid, service) {
    routeCache.delete(cacheKey(gid, service));
  }

  /**
   * @param {string | {service: string, gid?: string}} configuration
   * @param {Callback} [callback]
   */
  function get(configuration, callback) {
    callback = callback || function () { };

    const request = typeof configuration === 'string' ?
      { service: configuration, gid: context.gid } :
      { service: configuration.service, gid: configuration.gid || context.gid };

    const cached = getCached(request.gid, request.service);
    if (cached) {
      callback(null, cached);
      return;
    }

    const remote = { service: 'routes', method: 'get' };
    globalThis.distribution[context.gid].comm.send([request], remote, (errors, values) => {
      const hasErrors = errors && Object.keys(errors).length > 0;
      const hasValues = values && Object.keys(values).length > 0;
      if (!hasErrors || hasValues) {
        const normalizedValues = values || {};
        setCached(request.gid, request.service, normalizedValues);
        callback(null, normalizedValues);
        return;
      }

      globalThis.distribution.local.routes.get(request, (localErr, localService) => {
        if (!localErr && localService) {
          const localSid = globalThis.distribution.util.id.getSID(globalThis.distribution.node.config);
          const localValue = { [localSid]: localService };
          setCached(request.gid, request.service, localValue);
          callback(null, localValue);
          return;
        }

        callback(errors);
      });
    });
  }

  /**
   * @param {object} service
   * @param {string} name
   * @param {Callback} [callback]
   */
  function put(service, name, callback) {
    callback = callback || function () { };

    const remote = { service: 'routes', method: 'put' };
    globalThis.distribution[context.gid].comm.send([service, name], remote, (e, v) => {
      if (!e) {
        invalidateCache(context.gid, name);
      }
      callback(e, v);
    });
  }

  /**
   * @param {string} configuration
   * @param {Callback} [callback]
   */
  function rem(configuration, callback) {
    callback = callback || function () { };

    const remote = { service: 'routes', method: 'rem' };
    globalThis.distribution[context.gid].comm.send([configuration], remote, (e, v) => {
      if (!e) {
        invalidateCache(context.gid, configuration);
      }
      callback(e, v);
    });
  }

  return { get, put, rem };
}

module.exports = routes;
