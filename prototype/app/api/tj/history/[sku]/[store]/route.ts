import { NextResponse } from 'next/server'
import { getMockHistory } from '@/lib/mock-data'
import { getPriceHistoryFromDistribution } from '@/lib/tj-distribution'

const ALLOW_MOCK_FALLBACK = process.env.TJ_API_ALLOW_MOCK_FALLBACK !== '0'

export async function GET(
  _req: Request,
  { params }: { params: { sku: string; store: string } }
) {
  try {
    const history = await getPriceHistoryFromDistribution(params.sku, params.store)
    return NextResponse.json(history, { headers: { 'x-tj-data-source': 'distribution' } })
  } catch (err) {
    console.warn('Distribution history unavailable:', err)
    if (!ALLOW_MOCK_FALLBACK) {
      return NextResponse.json(
        { error: 'History backend unavailable and fallback disabled' },
        { status: 503, headers: { 'x-tj-data-source': 'none' } },
      )
    }
    const history = getMockHistory(params.sku)
    return NextResponse.json(history, { headers: { 'x-tj-data-source': 'mock' } })
  }
}
