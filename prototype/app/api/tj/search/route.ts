import { NextResponse } from 'next/server'
import { searchTJProducts } from '@/lib/tj'
import { searchMockProducts } from '@/lib/mock-data'
import { searchProductsFromDistribution } from '@/lib/tj-distribution'

const ALLOW_EXTERNAL_FALLBACK = process.env.TJ_API_ALLOW_EXTERNAL_FALLBACK !== '0'
const ALLOW_MOCK_FALLBACK = process.env.TJ_API_ALLOW_MOCK_FALLBACK !== '0'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const storeCode = searchParams.get('storeCode') ?? '701'
  const limitRaw = Number(searchParams.get('limit') ?? 20)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 20

  if (!q.trim()) {
    return NextResponse.json([])
  }

  try {
    const results = await searchProductsFromDistribution(q, storeCode, limit)
    return NextResponse.json(results, { headers: { 'x-tj-data-source': 'distribution' } })
  } catch (err) {
    console.warn('Distribution search unavailable, trying external TJ API:', err)

    if (ALLOW_EXTERNAL_FALLBACK) {
      try {
        const external = await searchTJProducts(q, storeCode)
        return NextResponse.json(external, { headers: { 'x-tj-data-source': 'external-tj' } })
      } catch (fallbackErr) {
        console.warn('TJ API unavailable:', fallbackErr)
      }
    }

    if (ALLOW_MOCK_FALLBACK) {
      const mock = searchMockProducts(q)
      return NextResponse.json(mock, { headers: { 'x-tj-data-source': 'mock' } })
    }

    return NextResponse.json(
      { error: 'Search backend unavailable and fallback disabled' },
      { status: 503, headers: { 'x-tj-data-source': 'none' } },
    )
  }
}
