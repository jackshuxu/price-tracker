import { CATEGORIES } from '@/lib/categories'
import { fetchAllCategories } from '@/lib/price-fetcher'
import type { PriceData } from '@/lib/price-fetcher'
import HeroSection from '@/components/HeroSection'

export const revalidate = 3600

export default async function HomePage() {
  const priceDataMap = await fetchAllCategories(CATEGORIES)

  const priceDataObj: Record<string, PriceData> = {}
  priceDataMap.forEach((v, k) => { priceDataObj[k] = v })

  return (
    <div>
      <HeroSection categories={CATEGORIES} priceDataMap={priceDataObj} />

      <footer
        style={{
          borderTop: '1px solid var(--cream-dark)',
          padding: '1.5rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '0.6rem', color: 'var(--ink-muted)', letterSpacing: '0.05em' }}>
          Data: BLS Average Price Series (monthly) · USDA AMS National Retail Reports (weekly) · EIA Petroleum Prices (weekly)
        </p>
        <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '0.6rem', color: 'var(--ink-muted)', letterSpacing: '0.05em' }}>
          National averages · Not seasonally adjusted
        </p>
      </footer>
    </div>
  )
}
