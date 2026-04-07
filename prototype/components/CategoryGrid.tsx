'use client'
import type { Category } from '@/lib/categories'
import type { PriceData } from '@/lib/bls'
import CategoryTile from './CategoryTile'

interface CategoryGridProps {
  categories: Category[]
  priceDataMap: Record<string, PriceData>
}

export default function CategoryGrid({ categories, priceDataMap }: CategoryGridProps) {
  // Sort by 3-month % change descending
  const sorted = [...categories].sort((a, b) => {
    const pa = priceDataMap[a.slug]?.pctChange3m ?? 0
    const pb = priceDataMap[b.slug]?.pctChange3m ?? 0
    return pb - pa
  })

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '1px',
        backgroundColor: 'var(--cream-dark)',
      }}
      className="
        sm:[grid-template-columns:repeat(3,1fr)]
        md:[grid-template-columns:repeat(4,1fr)]
        lg:[grid-template-columns:repeat(6,1fr)]
      "
    >
      {sorted.map((cat, i) => {
        const pd = priceDataMap[cat.slug]
        if (!pd) return null
        return (
          <CategoryTile
            key={cat.slug}
            slug={cat.slug}
            label={cat.label}
            shortLabel={cat.shortLabel}
            emoji={cat.emoji}
            unit={cat.unit}
            pctChange={pd.pctChange3m}
            current={pd.current}
            index={i}
          />
        )
      })}
    </div>
  )
}
