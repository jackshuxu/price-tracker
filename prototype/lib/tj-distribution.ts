import { callDistribution } from './distribution-client'

type DistributionConfig = {
  host: string
  port: number
  rpcGid: string
  indexGid: string
  priceGid: string
  storesGid: string
}

type Posting = {
  docId?: unknown
  sku?: unknown
  storeCode?: unknown
  name?: unknown
  score?: unknown
  lastSeen?: unknown
}

type PriceHistoryRow = {
  capturedAt?: unknown
  date?: unknown
  price?: unknown
}

type PriceRecord = {
  latestPrice?: unknown
  latestAt?: unknown
  history?: unknown
}

export type DistributionSearchProduct = {
  sku: string
  name: string
  price: number
  category: string
  size: string
  storeCode: string
  score: number
  latestAt: string
  matchedTerms: string[]
}

export type DistributionStore = {
  storeCode: string
  name: string
  city: string
  state: string
  address: string
  zip: string
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
  'you', 'your', 'our', 'we', 'they', 'he', 'she', 'its', 'was', 'were', 'will',
  'can', 'could', 'would', 'should', 'about', 'after', 'before', 'than', 'then',
])

let storesCache: { expiresAt: number; values: DistributionStore[] } | null = null

function safeString(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getConfig(): DistributionConfig {
  const parsedPort = Number(process.env.DISTRIBUTION_PORT ?? '12400')
  return {
    host: process.env.DISTRIBUTION_HOST ?? '127.0.0.1',
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 12400,
    rpcGid: process.env.DISTRIBUTION_RPC_GID ?? 'all',
    indexGid: process.env.DISTRIBUTION_INDEX_GID ?? 'tjindex',
    priceGid: process.env.DISTRIBUTION_PRICE_GID ?? 'tjprices',
    storesGid: process.env.DISTRIBUTION_STORES_GID ?? 'tjstores',
  }
}

async function storeGet<T>(config: DistributionConfig, gid: string, key: string | null): Promise<T | null> {
  try {
    return await callDistribution<T>(
      {
        host: config.host,
        port: config.port,
        gid: config.rpcGid,
        service: 'store',
        method: 'get',
      },
      [{ key, gid }],
    )
  } catch {
    return null
  }
}

function stemToken(token: string): string {
  let current = token
  if (current.length > 4 && current.endsWith('ies')) {
    return `${current.slice(0, -3)}y`
  }
  if (current.length > 5 && current.endsWith('ing')) {
    current = current.slice(0, -3)
  } else if (current.length > 4 && current.endsWith('ed')) {
    current = current.slice(0, -2)
  } else if (current.length > 4 && current.endsWith('es')) {
    current = current.slice(0, -2)
  } else if (current.length > 3 && current.endsWith('s')) {
    current = current.slice(0, -1)
  }
  return current
}

function tokenize(input: string): string[] {
  return safeString(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))
    .map((token) => stemToken(token))
    .filter(Boolean)
}

function buildQueryTerms(query: string): string[] {
  const tokens = tokenize(query)
  const terms: string[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    terms.push(tokens[i])
  }
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    terms.push(`${tokens[i]} ${tokens[i + 1]}`)
  }
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    terms.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }

  return Array.from(new Set(terms))
}

function normalizeStoreRecord(key: string, value: unknown): DistributionStore {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    storeCode: safeString(row.storeCode ?? row.store_code ?? key).trim(),
    name: safeString(row.name ?? `Trader Joe's ${key}`).trim(),
    city: safeString(row.city).trim(),
    state: safeString(row.state).trim().toUpperCase(),
    address: safeString(row.address).trim(),
    zip: safeString(row.zip ?? row.postalCode).trim(),
  }
}

export async function searchProductsFromDistribution(
  query: string,
  storeCode: string,
  limit: number,
): Promise<DistributionSearchProduct[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const config = getConfig()
  const terms = buildQueryTerms(trimmedQuery)
  if (terms.length === 0) {
    return []
  }

  const termRows = await Promise.all(
    terms.map(async (term) => {
      const entry = await storeGet<Record<string, unknown>>(config, config.indexGid, term)
      return { term, entry }
    }),
  )

  const scored = new Map<string, {
    sku: string
    storeCode: string
    name: string
    score: number
    lastSeen: string
    matchedTerms: Set<string>
  }>()

  for (const row of termRows) {
    const postingsRaw = row.entry && Array.isArray(row.entry.postings)
      ? (row.entry.postings as Posting[])
      : []

    for (const posting of postingsRaw) {
      const postingStoreCode = safeString(posting.storeCode).trim()
      if (storeCode && postingStoreCode && postingStoreCode !== storeCode) {
        continue
      }

      const sku = safeString(posting.sku).trim()
      const docId = safeString(posting.docId).trim() || (sku ? `${sku}|${postingStoreCode || storeCode || 'unknown'}` : '')
      if (!docId || !sku) {
        continue
      }

      if (!scored.has(docId)) {
        scored.set(docId, {
          sku,
          storeCode: postingStoreCode || storeCode || 'unknown',
          name: safeString(posting.name).trim(),
          score: 0,
          lastSeen: safeString(posting.lastSeen),
          matchedTerms: new Set<string>(),
        })
      }

      const target = scored.get(docId)
      if (!target) {
        continue
      }

      target.score += safeNumber(posting.score, 0)
      target.matchedTerms.add(row.term)
      if (safeString(posting.name)) {
        target.name = safeString(posting.name).trim()
      }
      if (safeString(posting.lastSeen)) {
        target.lastSeen = safeString(posting.lastSeen)
      }
      if (postingStoreCode) {
        target.storeCode = postingStoreCode
      }
    }
  }

  const ranked = Array.from(scored.values())
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score
      }
      if (left.matchedTerms.size !== right.matchedTerms.size) {
        return right.matchedTerms.size - left.matchedTerms.size
      }
      return left.sku.localeCompare(right.sku)
    })
    .slice(0, Math.max(1, limit))

  const products = await Promise.all(
    ranked.map(async (row) => {
      const priceKey = `${row.sku}|${row.storeCode}`
      const priceRecord = await storeGet<PriceRecord>(config, config.priceGid, priceKey)
      const latestPrice = safeNumber(priceRecord?.latestPrice, Number.NaN)
      return {
        sku: row.sku,
        name: row.name || row.sku,
        price: Number.isFinite(latestPrice) ? latestPrice : 0,
        category: '',
        size: '',
        storeCode: row.storeCode,
        score: Number(row.score.toFixed(6)),
        latestAt: safeString(priceRecord?.latestAt || row.lastSeen),
        matchedTerms: Array.from(row.matchedTerms),
      }
    }),
  )

  return products
}

export async function getPriceHistoryFromDistribution(sku: string, storeCode: string): Promise<Array<{ date: string; price: number }>> {
  if (!sku || !storeCode) {
    return []
  }

  const config = getConfig()
  const key = `${sku}|${storeCode}`
  const record = await storeGet<PriceRecord>(config, config.priceGid, key)
  const rows = Array.isArray(record?.history) ? (record?.history as PriceHistoryRow[]) : []

  return rows
    .map((row) => ({
      date: safeString(row.capturedAt ?? row.date).trim(),
      price: safeNumber(row.price, Number.NaN),
    }))
    .filter((row) => row.date && Number.isFinite(row.price))
    .sort((left, right) => left.date.localeCompare(right.date))
}

export async function listStoresFromDistribution(state: string): Promise<DistributionStore[]> {
  const config = getConfig()
  const now = Date.now()

  if (!storesCache || storesCache.expiresAt <= now) {
    const keys = await storeGet<string[]>(config, config.storesGid, null)
    const uniqueKeys = Array.isArray(keys)
      ? Array.from(new Set(keys.map((key) => safeString(key)).filter(Boolean)))
      : []

    const records = await Promise.all(
      uniqueKeys.map(async (key) => {
        const value = await storeGet<unknown>(config, config.storesGid, key)
        return normalizeStoreRecord(key, value)
      }),
    )

    storesCache = {
      expiresAt: now + 60_000,
      values: records,
    }
  }

  const normalizedState = state.trim().toUpperCase()
  const filtered = normalizedState
    ? storesCache.values.filter((store) => store.state === normalizedState)
    : storesCache.values

  return filtered.sort((left, right) => {
    if (left.state !== right.state) {
      return left.state.localeCompare(right.state)
    }
    if (left.city !== right.city) {
      return left.city.localeCompare(right.city)
    }
    return left.storeCode.localeCompare(right.storeCode)
  })
}
