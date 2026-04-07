import { NextResponse } from 'next/server'
import { getCategoryBySlug } from '@/lib/categories'
import { fetchPrice } from '@/lib/price-fetcher'

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const category = getCategoryBySlug(params.slug)
  if (!category) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 404 })
  }
  try {
    const data = await fetchPrice(category)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
