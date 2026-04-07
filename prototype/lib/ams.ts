import { MOCK_DATA } from './mock-data'
import type { PriceData } from './bls'
import type { Category } from './categories'

// USDA AMS MARS API — Weekly Grocery Store retail price reports
// Auth: Basic auth (API key as username, empty password)
// Report 2995 (DYBRETAIL): dairy — has structured price data per commodity/region
// Response shape: { results: [{ report_begin_date, commodity, wtd_avg_price, ... }] }

interface AMSRecord {
  report_begin_date?: string   // "MM/DD/YYYY"
  commodity?: string
  wtd_avg_price?: number | null
  organic?: string
  package?: string
  [key: string]: unknown
}

interface AMSResponse {
  results?: AMSRecord[]
  stats?: { totalRows: number }
}

function parseAMSDate(mmddyyyy: string): string {
  // "MM/DD/YYYY" → "YYYY-MM-DD"
  const [m, d, y] = mmddyyyy.split('/')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function parseAMSResponse(category: Category, json: AMSResponse): PriceData {
  const records = json.results
  if (!records || records.length === 0) throw new Error('AMS: empty results')

  // Group wtd_avg_price by week date and average across regions
  const byWeek = new Map<string, number[]>()
  for (const r of records) {
    if (!r.report_begin_date || r.wtd_avg_price == null) continue
    const date = parseAMSDate(r.report_begin_date)
    if (!byWeek.has(date)) byWeek.set(date, [])
    byWeek.get(date)!.push(r.wtd_avg_price)
  }

  const history = Array.from(byWeek.entries())
    .map(([date, prices]) => ({
      date,
      value: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 1000) / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-104) // keep ~2 years of weekly data

  if (history.length < 4) throw new Error(`AMS: insufficient data for ${category.slug} (${history.length} weeks)`)

  const current = history[history.length - 1].value
  // 3 months ≈ 13 weeks (index -14), 12 months ≈ 52 weeks (index -53)
  const prev3m = history[Math.max(0, history.length - 14)].value
  const prev12m = history[Math.max(0, history.length - 53)].value

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

export async function fetchAMSPrice(category: Category): Promise<PriceData> {
  const apiKey = process.env.USDA_AMS_API_KEY
  if (!apiKey) throw new Error('USDA_AMS_API_KEY not set')

  const today = new Date()
  const twoYearsAgo = new Date(today)
  twoYearsAgo.setFullYear(today.getFullYear() - 2)

  // Format as MM/DD/YYYY for AMS query
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

  // Build URL manually — URLSearchParams encodes = and / inside q values which breaks AMS
  const qParams: string[] = [
    `q=report_begin_date=${fmt(twoYearsAgo)}:${fmt(today)}`,
    'q=organic=No',
  ]
  if (category.commodity) qParams.push(`q=commodity=${encodeURIComponent(category.commodity)}`)
  if (category.amsPackage) qParams.push(`q=package=${encodeURIComponent(category.amsPackage)}`)

  const url = `https://marsapi.ams.usda.gov/services/v1.2/reports/${category.sourceId}?${qParams.join('&')}`

  try {
    const credentials = Buffer.from(`${apiKey}:`).toString('base64')
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}` },
      next: { revalidate: 3600 * 6 },
    })

    if (!res.ok) throw new Error(`AMS HTTP ${res.status}: ${await res.text()}`)

    const json: AMSResponse = await res.json()
    return parseAMSResponse(category, json)
  } catch (err) {
    console.warn(`AMS fetch failed for ${category.slug}, using mock data:`, err)
    const mock = MOCK_DATA[category.seriesId]
    if (!mock) throw new Error(`No mock data for ${category.seriesId}`)
    return mock
  }
}
