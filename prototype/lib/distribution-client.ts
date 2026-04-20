type Encoded = {
  type: string
  value: unknown
}

function encode(input: unknown): Encoded {
  if (input === null) return { type: 'NULL', value: null }

  const t = typeof input
  if (t === 'undefined') return { type: 'undefined', value: undefined }
  if (t === 'string') return { type: 'str', value: input }
  if (t === 'boolean') return { type: 'bool', value: input }

  if (t === 'number') {
    const n = input as number
    if (Number.isNaN(n)) return { type: 'num', value: 'NaN' }
    if (!Number.isFinite(n)) return { type: 'num', value: n > 0 ? 'Inf' : '-Inf' }
    if (Object.is(n, -0)) return { type: 'num', value: '-0' }
    return { type: 'num', value: n }
  }

  if (t === 'bigint') return { type: 'bigint', value: String(input) }
  if (t === 'function') return { type: 'fun', value: (input as Function).toString() }
  if (input instanceof Date) return { type: 'date', value: input.toISOString() }

  if (input instanceof Error) {
    return {
      type: 'err',
      value: {
        name: input.name,
        message: input.message,
        stack: input.stack,
        cause: input.cause ? encode(input.cause) : undefined,
      },
    }
  }

  if (Array.isArray(input)) {
    return { type: 'arr', value: input.map((x) => encode(x)) }
  }

  if (t === 'object') {
    const obj = input as Record<string, unknown>
    const out: Record<string, Encoded> = {}
    for (const key of Object.keys(obj)) {
      out[key] = encode(obj[key])
    }
    return { type: 'obj', value: out }
  }

  throw new Error(`Unsupported type: ${t}`)
}

function decode(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input
  const wrapped = input as { type?: string; value?: unknown }

  switch (wrapped.type) {
    case 'NULL':
      return null
    case 'undefined':
      return undefined
    case 'str':
      return String(wrapped.value)
    case 'bool':
      return Boolean(wrapped.value)
    case 'num': {
      const value = wrapped.value
      if (value === 'NaN') return NaN
      if (value === 'Inf') return Infinity
      if (value === '-Inf') return -Infinity
      if (value === '-0') return -0
      return Number(value)
    }
    case 'fun':
      return eval('(' + String(wrapped.value) + ')')
    case 'date':
      return new Date(String(wrapped.value))
    case 'bigint':
      return BigInt(String(wrapped.value))
    case 'err': {
      const payload = (wrapped.value || {}) as Record<string, unknown>
      const err = new Error(String(payload.message || 'Unknown error'))
      err.name = String(payload.name || 'Error')
      if (payload.stack) err.stack = String(payload.stack)
      if (payload.cause) err.cause = decode(payload.cause)
      return err
    }
    case 'arr':
      return Array.isArray(wrapped.value)
        ? (wrapped.value as unknown[]).map((x) => decode(x))
        : []
    case 'obj': {
      const inObj = (wrapped.value || {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(inObj)) {
        out[key] = decode(inObj[key])
      }
      return out
    }
    default:
      throw new Error(`Unknown encoded type: ${String(wrapped.type)}`)
  }
}

function serialize(input: unknown): string {
  return JSON.stringify(encode(input))
}

function deserialize(payload: string): unknown {
  return decode(JSON.parse(payload))
}

export type DistributionTarget = {
  host: string
  port: number
  gid: string
  service: string
  method: string
}

export async function callDistribution<T>(
  target: DistributionTarget,
  message: unknown[]
): Promise<T> {
  const url = `http://${target.host}:${target.port}/${target.gid}/${target.service}/${target.method}`

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: serialize(message),
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Distribution RPC HTTP ${res.status}`)
  }

  const text = await res.text()
  const decoded = deserialize(text)

  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error('Distribution RPC malformed response')
  }

  const err = decoded[0]
  const value = decoded[1]
  if (err) {
    if (err instanceof Error) throw err
    throw new Error(String(err))
  }

  return value as T
}
