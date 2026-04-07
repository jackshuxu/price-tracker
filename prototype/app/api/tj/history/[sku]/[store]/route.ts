import { NextResponse } from 'next/server'
import { getMockHistory } from '@/lib/mock-data'

export async function GET(
  _req: Request,
  { params }: { params: { sku: string; store: string } }
) {
  // Future: hit tjprices GID in the distribution cluster for real history
  // For now, return the single current price point from mock data
  const history = getMockHistory(params.sku)
  return NextResponse.json(history)
}
