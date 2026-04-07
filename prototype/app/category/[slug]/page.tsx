import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCategoryBySlug, CATEGORIES } from '@/lib/categories'
import { fetchPrice } from '@/lib/price-fetcher'
import { formatDate } from '@/lib/bls'
import TrendChart from '@/components/TrendChart'

export const revalidate = 3600

export async function generateStaticParams() {
  return CATEGORIES.map(c => ({ slug: c.slug }))
}

export default async function CategoryPage({
  params,
}: {
  params: { slug: string }
}) {
  const category = getCategoryBySlug(params.slug)
  if (!category) notFound()

  const data = await fetchPrice(category)

  const sign3m = data.pctChange3m >= 0 ? '+' : ''
  const sign12m = data.pctChange12m >= 0 ? '+' : ''
  const trendColor = data.pctChange3m > 0 ? 'var(--amber)' : 'var(--moss)'
  const latestDate = data.history[data.history.length - 1]?.date
  const oldestDate = data.history[0]?.date

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '3rem 2rem 5rem' }}>
      {/* Back link */}
      <Link
        href="/"
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.62rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-muted)',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginBottom: '2rem',
          transition: 'color 0.15s ease',
        }}
      >
        ← All categories
      </Link>

      {/* Category tag */}
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.6rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--amber)',
          marginBottom: '0.5rem',
        }}
      >
        Consumer Price · {category.unit.replace('/', 'per ')}
      </p>

      {/* Large heading */}
      <h1
        style={{
          fontFamily: 'var(--font-fraunces), Georgia, serif',
          fontSize: 'clamp(2.8rem, 8vw, 5.5rem)',
          fontWeight: 700,
          lineHeight: 0.95,
          letterSpacing: '-0.03em',
          color: 'var(--ink)',
          marginBottom: '0.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span>{category.emoji}</span>
        <span>{category.shortLabel}</span>
      </h1>

      <p
        style={{
          fontFamily: 'var(--font-lora), serif',
          fontStyle: 'italic',
          fontSize: '0.95rem',
          color: 'var(--ink-muted)',
          marginBottom: '2rem',
        }}
      >
        {category.description}
      </p>

      {/* Thick rule */}
      <div style={{ borderTop: '2px solid var(--ink)', marginBottom: '2rem' }} />

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '1px',
          backgroundColor: 'var(--cream-dark)',
          marginBottom: '2.5rem',
        }}
      >
        <StatCell label="Current price" value={`$${data.current.toFixed(3)}`} unit={category.unit} />
        <StatCell
          label="3-month change"
          value={`${sign3m}${data.pctChange3m.toFixed(1)}%`}
          valueColor={trendColor}
          subValue={`was $${data.prev3m.toFixed(3)}`}
        />
        <StatCell
          label="12-month change"
          value={`${sign12m}${data.pctChange12m.toFixed(1)}%`}
          valueColor={data.pctChange12m > 0 ? 'var(--amber)' : 'var(--moss)'}
          subValue={`was $${data.prev12m.toFixed(3)}`}
        />
        {latestDate && (
          <StatCell label="Latest data" value={formatDate(latestDate)} />
        )}
      </div>

      {/* Chart */}
      <div
        style={{
          background: 'var(--cream)',
          border: '1px solid var(--cream-dark)',
          padding: '1.5rem 1rem 1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '1rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize: '0.62rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-muted)',
            }}
          >
            Price history — 24 months
          </p>
          {oldestDate && latestDate && (
            <p
              style={{
                fontFamily: 'var(--font-mono), monospace',
                fontSize: '0.58rem',
                color: 'var(--ink-muted)',
              }}
            >
              {formatDate(oldestDate)} → {formatDate(latestDate)}
            </p>
          )}
        </div>

        <TrendChart data={data.history} unit={category.unit} height={340} />
      </div>

      {/* Methodology note */}
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.58rem',
          color: 'var(--ink-muted)',
          letterSpacing: '0.04em',
          marginTop: '1.5rem',
          lineHeight: 1.7,
        }}
      >
        {category.source === 'ams' && (
          <>Source: USDA Agricultural Marketing Service, National Retail Report #{category.sourceId}
          ({category.commodity}). Weekly retail prices surveyed from grocery stores nationwide.</>
        )}
        {category.source === 'eia' && (
          <>Source: U.S. Energy Information Administration, series {category.sourceId}.
          Weekly retail gasoline prices, national average, all formulations.</>
        )}
        {category.source === 'bls' && (
          <>Source: U.S. Bureau of Labor Statistics, Average Price Series {category.seriesId}.
          National average prices collected monthly from retail stores. Not seasonally adjusted.</>
        )}
      </p>
    </div>
  )
}

function StatCell({
  label,
  value,
  unit,
  valueColor,
  subValue,
}: {
  label: string
  value: string
  unit?: string
  valueColor?: string
  subValue?: string
}) {
  return (
    <div
      style={{
        background: 'var(--cream)',
        padding: '1rem 1.25rem',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.55rem',
          color: 'var(--ink-muted)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: '0.35rem',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '1.5rem',
          fontWeight: 600,
          color: valueColor ?? 'var(--ink)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {value}
        {unit && (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 400,
              color: 'var(--ink-muted)',
              marginLeft: '0.2rem',
            }}
          >
            {unit}
          </span>
        )}
      </p>
      {subValue && (
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.6rem',
            color: 'var(--ink-muted)',
            marginTop: '0.2rem',
          }}
        >
          {subValue}
        </p>
      )}
    </div>
  )
}
