// @ts-check

/**
 * @param {any} object
 * @returns {string}
 */
function serialize(object) {
  /**
   * @param {any} input
   * @returns {any}
   */
  function dfs_fwd(input) {
    if (input === null) {
      return {
        type: 'NULL',
        value: null
      };
    }

    const type = typeof input;

    if (type === 'undefined') {
      return {
        type: 'undefined',
        value: undefined
      };
    }

    if (type === 'string') {
      return {
        type: 'str',
        value: input
      };
    }

    if (type === 'boolean') {
      return {
        type: 'bool',
        value: input
      };
    }

    if (type === 'number') {
      if (isNaN(input)) {
        return {
          type: 'num',
          value: 'NaN'
        };
      } else if (!isFinite(input)) {
        return {
          type: 'num',
          value: (input > 0 ? 'Inf' : '-Inf')
        };
      } else if (input === 0 && 1 / input === -Infinity) {
        return {
          type: 'num',
          value: '-0'
        };
      } else {
        return {
          type: 'num',
          value: input
        };
      }
    }

    if (type === 'bigint') {
      return {
        type: 'bigint',
        value: input.toString()
      };
    }

    if (type === 'function') {
      return {
        type: 'fun',
        value: input.toString()
      };
    }

    if (input instanceof Date) {
      return {
        type: 'date',
        value: input.toISOString()
      };
    }

    if (input instanceof Error) {
      return {
        type: 'err',
        value: {
          name: input.name,
          message: input.message,
          stack: input.stack,
          cause: input.cause ? dfs_fwd(input.cause) : undefined
        }
      };
    }

    if (Array.isArray(input)) {
      return {
        type: 'arr',
        value: input.map(dfs_fwd)
      };
    }

    if (type === 'object') {
      /** @type {Object.<string, any>} */
      const tmp = {};
      for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          tmp[key] = dfs_fwd(input[key]);
        }
      }
      return {
        type: 'obj',
        value: tmp
      };
    }

    throw new Error(`Unsupported type for this M1: ${type}`);
  }

  return JSON.stringify(dfs_fwd(object));
}


/**
 * @param {string} string
 * @returns {any}
 */
function deserialize(string) {
  if (typeof string !== 'string') {
    throw new Error(`Invalid argument type: ${typeof string}.`);
  }

  const parsed = JSON.parse(string);

  /**
   * @param {any} input
   * @returns {any}
   */
  function dfs_bwd(input) {
    if (input === null || typeof input !== 'object') {
      return input;
    }

    const { type, value } = input;

    switch (type) {
      case 'NULL':
        return null;

      case 'undefined':
        return undefined;

      case 'num':
        if (value === 'NaN') {
          return NaN;
        }
        if (value === 'Inf') {
          return Infinity;
        }
        if (value === '-Inf') {
          return -Infinity;
        }
        return Number(value);

      case 'str':
        return String(value);

      case 'bool':
        return Boolean(value);

      case 'fun':
        return eval('(' + value + ')');

      case 'date':
        return new Date(value);

      case 'bigint':
        return BigInt(value);

      case 'err':
        const e = new Error(value.message);
        e.name = value.name;
        e.stack = value.stack;
        if (value.cause) {
          e.cause = dfs_bwd(value.cause);
        }
        return e;

      case 'arr':
        return value.map(dfs_bwd);

      case 'obj':
        /** @type {Object.<string, any>} */
        const tmp = {};
        for (const key in value) {
          tmp[key] = dfs_bwd(value[key]);
        }
        return tmp;

      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  return dfs_bwd(parsed);
}

module.exports = {
  serialize,
  deserialize,
};