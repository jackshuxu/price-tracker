type PricePoint = {
  date: string
  price: number
}

type ExplainSource = 'distribution' | 'mock' | 'none'

type Trend = 'up' | 'down' | 'flat' | 'insufficient-data'

export type PriceExplanation = {
  sku: string
  storeCode: string
  source: ExplainSource
  points: number
  latestPrice: number | null
  latestDate: string | null
  previousPrice: number | null
  delta: number | null
  deltaPct: number | null
  minPrice: number | null
  maxPrice: number | null
  avgPrice: number | null
  trend: Trend
  narrative: string
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function normalizeHistory(history: PricePoint[]): PricePoint[] {
  return history
    .filter((row) => row && typeof row.date === 'string' && Number.isFinite(Number(row.price)))
    .map((row) => ({ date: row.date, price: Number(row.price) }))
    .sort((left, right) => left.date.localeCompare(right.date))
}

export function buildPriceExplanation(
  sku: string,
  storeCode: string,
  source: ExplainSource,
  history: PricePoint[],
): PriceExplanation {
  const rows = normalizeHistory(history)

  if (rows.length === 0) {
    return {
      sku,
      storeCode,
      source,
      points: 0,
      latestPrice: null,
      latestDate: null,
      previousPrice: null,
      delta: null,
      deltaPct: null,
      minPrice: null,
      maxPrice: null,
      avgPrice: null,
      trend: 'insufficient-data',
      narrative: 'No historical price samples are available for this SKU/store.',
    }
  }

  const latest = rows[rows.length - 1]
  const previous = rows.length > 1 ? rows[rows.length - 2] : null

  const minPrice = rows.reduce((min, row) => Math.min(min, row.price), Number.POSITIVE_INFINITY)
  const maxPrice = rows.reduce((max, row) => Math.max(max, row.price), Number.NEGATIVE_INFINITY)
  const avgPrice = rows.reduce((sum, row) => sum + row.price, 0) / rows.length

  let delta = null
  let deltaPct = null
  let trend: Trend = 'flat'

  if (previous) {
    delta = round(latest.price - previous.price)
    if (Math.abs(delta) < 0.01) {
      trend = 'flat'
    } else if (delta > 0) {
      trend = 'up'
    } else {
      trend = 'down'
    }

    if (Math.abs(previous.price) > 1e-9) {
      deltaPct = round((delta / previous.price) * 100)
    }
  } else {
    trend = 'insufficient-data'
  }

  const trendPhrase =
    trend === 'up'
      ? 'moved up'
      : trend === 'down'
        ? 'moved down'
        : trend === 'flat'
          ? 'stayed flat'
          : 'has insufficient trend data'

  const deltaPart =
    delta === null
      ? ''
      : ` (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}${deltaPct === null ? '' : `, ${deltaPct.toFixed(2)}%`})`

  const narrative =
    `Latest price is $${latest.price.toFixed(2)} on ${latest.date}; ` +
    `${trendPhrase}${deltaPart}. ` +
    `Observed range is $${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)} across ${rows.length} sample(s).`

  return {
    sku,
    storeCode,
    source,
    points: rows.length,
    latestPrice: round(latest.price),
    latestDate: latest.date,
    previousPrice: previous ? round(previous.price) : null,
    delta,
    deltaPct,
    minPrice: round(minPrice),
    maxPrice: round(maxPrice),
    avgPrice: round(avgPrice),
    trend,
    narrative,
  }
}
