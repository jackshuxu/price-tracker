import { NextResponse } from 'next/server'
import { searchTJProducts } from '@/lib/tj'
import { searchMockProducts } from '@/lib/mock-data'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const storeCode = searchParams.get('storeCode') ?? '701'

  if (!q.trim()) {
    return NextResponse.json([])
  }

  try {
    const results = await searchTJProducts(q, storeCode)
    return NextResponse.json(results)
  } catch (err) {
    console.warn('TJ API unavailable, using mock:', err)
    const mock = searchMockProducts(q)
    return NextResponse.json(mock)
  }
}
