import type { Category } from './categories'
import type { PriceData } from './bls'
import { fetchBLSPrice } from './bls'
import { fetchAMSPrice } from './ams'
import { fetchEIAPrice } from './eia'

export type { PriceData }

export async function fetchPrice(category: Category): Promise<PriceData> {
  switch (category.source) {
    case 'ams': return fetchAMSPrice(category)
    case 'eia': return fetchEIAPrice(category)
    default:    return fetchBLSPrice(category)
  }
}

export async function fetchAllCategories(
  categories: Category[]
): Promise<Map<string, PriceData>> {
  const results = await Promise.allSettled(
    categories.map(c => fetchPrice(c).then(d => ({ slug: c.slug, data: d })))
  )

  const map = new Map<string, PriceData>()
  for (const r of results) {
    if (r.status === 'fulfilled') {
      map.set(r.value.slug, r.value.data)
    }
  }
  return map
}
