import { NextResponse } from 'next/server'
import { getMockHistory } from '@/lib/mock-data'
import { getPriceHistoryFromDistribution } from '@/lib/tj-distribution'
import { buildPriceExplanation } from '@/lib/tj-explain'

const EXPLAIN_ENABLED = process.env.TJ_API_EXPLAIN_ENABLED === '1'
const ALLOW_MOCK_FALLBACK = process.env.TJ_API_ALLOW_MOCK_FALLBACK !== '0'

export async function GET(req: Request) {
  if (!EXPLAIN_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'x-tj-data-source': 'none' } })
  }

  const { searchParams } = new URL(req.url)
  const sku = (searchParams.get('sku') ?? '').trim()
  const storeCode = (searchParams.get('storeCode') ?? '701').trim()

  if (!sku) {
    return NextResponse.json(
      { error: 'Missing required query parameter: sku' },
      { status: 400, headers: { 'x-tj-data-source': 'none' } },
    )
  }

  try {
    const history = await getPriceHistoryFromDistribution(sku, storeCode)
    if (history.length > 0) {
      const explanation = buildPriceExplanation(sku, storeCode, 'distribution', history)
      return NextResponse.json(explanation, { headers: { 'x-tj-data-source': 'distribution' } })
    }

    if (!ALLOW_MOCK_FALLBACK) {
      const explanation = buildPriceExplanation(sku, storeCode, 'none', [])
      return NextResponse.json(explanation, { headers: { 'x-tj-data-source': 'none' } })
    }

    const mockHistory = getMockHistory(sku)
    const explanation = buildPriceExplanation(sku, storeCode, 'mock', mockHistory)
    return NextResponse.json(explanation, { headers: { 'x-tj-data-source': 'mock' } })
  } catch (error) {
    console.warn('Explain route distribution read failed:', error)

    if (!ALLOW_MOCK_FALLBACK) {
      return NextResponse.json(
        { error: 'Explain backend unavailable and fallback disabled' },
        { status: 503, headers: { 'x-tj-data-source': 'none' } },
      )
    }

    const mockHistory = getMockHistory(sku)
    const explanation = buildPriceExplanation(sku, storeCode, 'mock', mockHistory)
    return NextResponse.json(explanation, { headers: { 'x-tj-data-source': 'mock' } })
  }
}
