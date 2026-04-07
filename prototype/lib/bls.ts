import { MOCK_DATA } from './mock-data'
import type { Category } from './categories'

export interface PriceData {
  seriesId: string
  current: number
  prev3m: number
  prev12m: number
  pctChange3m: number
  pctChange12m: number
  history: { date: string; value: number }[]
}

interface BLSDataPoint {
  year: string
  period: string
  value: string
  latest?: string
}

interface BLSResponse {
  status: string
  Results?: {
    series: { seriesID: string; data: BLSDataPoint[] }[]
  }
}

function parseBLSResponse(seriesId: string, json: BLSResponse): PriceData | null {
  if (json.status !== 'REQUEST_SUCCEEDED' || !json.Results?.series?.[0]?.data) {
    return null
  }

  const raw = json.Results.series[0].data
  const points = raw
    .filter(d => d.period.startsWith('M') && d.period !== 'M13')
    .map(d => ({
      date: `${d.year}-${d.period.slice(1).padStart(2, '0')}`,
      value: parseFloat(d.value),
    }))
    .filter(d => !isNaN(d.value))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (points.length < 4) return null

  const history = points.slice(-24)
  const current = history[history.length - 1].value
  const prev3m = history[history.length - 4]?.value ?? history[0].value
  const prev12m = history.length >= 13 ? history[history.length - 13].value : history[0].value

  return {
    seriesId,
    current,
    prev3m,
    prev12m,
    pctChange3m: ((current - prev3m) / prev3m) * 100,
    pctChange12m: ((current - prev12m) / prev12m) * 100,
    history,
  }
}

export async function fetchBLSPrice(category: Category): Promise<PriceData> {
  const seriesId = category.sourceId
  try {
    const res = await fetch(
      `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`,
      {
        headers: { 'Content-Type': 'application/json' },
        next: { revalidate: 3600 },
      }
    )

    if (!res.ok) throw new Error(`BLS HTTP ${res.status}`)

    const json: BLSResponse = await res.json()
    const parsed = parseBLSResponse(seriesId, json)

    if (!parsed) throw new Error('BLS parse failed')
    return parsed
  } catch (err) {
    console.warn(`BLS fetch failed for ${seriesId}, using mock data:`, err)
    const mock = MOCK_DATA[category.seriesId]
    if (!mock) throw new Error(`No mock data for ${category.seriesId}`)
    return mock
  }
}

export function formatDate(dateStr: string): string {
  const [year, month] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${year}`
}
