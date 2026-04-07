import { MOCK_DATA } from './mock-data'
import type { PriceData } from './bls'
import type { Category } from './categories'

interface EIARecord {
  period: string
  value: number | string | null
}

interface EIAResponse {
  response?: {
    data?: EIARecord[]
  }
}

function parseEIAResponse(category: Category, json: EIAResponse): PriceData {
  const records = json.response?.data
  if (!records || records.length === 0) throw new Error('EIA: empty data')

  const isWeekly = category.eiaConfig?.frequency === 'weekly'

  const points = records
    .filter(r => r.value !== null && r.value !== undefined)
    .map(r => ({
      date: String(r.period).slice(0, 10), // YYYY-MM-DD (weekly) or YYYY-MM (monthly)
      value: typeof r.value === 'string' ? parseFloat(r.value) : Number(r.value),
    }))
    .filter(p => !isNaN(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (points.length < 4) throw new Error('EIA: insufficient data points')

  const maxPoints = isWeekly ? 110 : 36
  const history = points.slice(-maxPoints)
  const current = history[history.length - 1].value

  // Weekly: 3m ≈ 13 weeks back (index -14), 12m ≈ 52 weeks back (index -53)
  // Monthly: 3m = 3 months back (index -4), 12m = 12 months back (index -13)
  const prev3mIdx = isWeekly ? history.length - 14 : history.length - 4
  const prev12mIdx = isWeekly ? history.length - 53 : history.length - 13
  const prev3m = history[Math.max(0, prev3mIdx)]?.value ?? history[0].value
  const prev12m = history[Math.max(0, prev12mIdx)]?.value ?? history[0].value

  return {
    seriesId: category.seriesId,
    current,
    prev3m,
    prev12m,
    pctChange3m: ((current - prev3m) / prev3m) * 100,
    pctChange12m: ((current - prev12m) / prev12m) * 100,
    history,
  }
}

export async function fetchEIAPrice(category: Category): Promise<PriceData> {
  const apiKey = process.env.EIA_API_KEY
  if (!apiKey) throw new Error('EIA_API_KEY not set')

  const cfg = category.eiaConfig
  if (!cfg) throw new Error(`EIA config missing for ${category.slug}`)

  const isWeekly = cfg.frequency === 'weekly'
  const length = isWeekly ? '110' : '36'

  const url = new URL(`https://api.eia.gov/v2/${cfg.dataset}/data/`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('frequency', cfg.frequency)
  url.searchParams.append('data[]', 'value')
  for (const [k, v] of Object.entries(cfg.facets)) {
    url.searchParams.append(`facets[${k}][]`, v)
  }
  url.searchParams.append('sort[0][column]', 'period')
  url.searchParams.append('sort[0][direction]', 'desc')
  url.searchParams.set('length', length)

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: isWeekly ? 3600 * 6 : 3600 * 24 },
    })

    if (!res.ok) throw new Error(`EIA HTTP ${res.status}`)

    const json: EIAResponse = await res.json()
    return parseEIAResponse(category, json)
  } catch (err) {
    console.warn(`EIA fetch failed for ${category.slug}, using mock data:`, err)
    const mock = MOCK_DATA[category.seriesId]
    if (!mock) throw new Error(`No mock data for ${category.seriesId}`)
    return mock
  }
}
