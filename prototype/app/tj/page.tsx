'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import StoreSearch from '@/components/StoreSearch'
import { STATE_NAMES } from '@/lib/state-zips'

// USMap must be loaded client-only (react-simple-maps uses D3)
const USMap = dynamic(() => import('@/components/USMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        aspectRatio: '960/600',
        background: 'var(--cream-dark)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.65rem',
          color: 'var(--ink-muted)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        Loading map...
      </p>
    </div>
  ),
})

export default function TJPage() {
  const [selectedState, setSelectedState] = useState<string | null>(null)

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <header style={{ padding: '3rem 2rem 1.5rem' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.62rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--amber)',
            marginBottom: '0.5rem',
          }}
        >
          Trader Joe&apos;s · Store Prices
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif',
            fontSize: 'clamp(2rem, 5vw, 3.5rem)',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
          }}
        >
          Find your store,
          <br />
          <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--ink-muted)' }}>
            search any product
          </em>
        </h1>
        <div style={{ borderTop: '2px solid var(--ink)', marginTop: '1.25rem' }} />
      </header>

      {/* Two-column layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 0,
          padding: '0 0 4rem',
        }}
        className="lg:grid-cols-[3fr_2fr]"
      >
        {/* Left: Map */}
        <div
          style={{
            padding: '0',
            borderRight: '1px solid var(--cream-dark)',
          }}
        >
          {/* Map section label */}
          <div
            style={{
              padding: '0.75rem 2rem',
              borderBottom: '1px solid var(--cream-dark)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-mono), monospace',
                fontSize: '0.6rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ink-muted)',
              }}
            >
              Select your state
            </p>
            {selectedState && (
              <button
                onClick={() => setSelectedState(null)}
                style={{
                  fontFamily: 'var(--font-mono), monospace',
                  fontSize: '0.6rem',
                  letterSpacing: '0.1em',
                  color: 'var(--amber)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textTransform: 'uppercase',
                }}
              >
                Clear — {STATE_NAMES[selectedState] ?? selectedState}
              </button>
            )}
          </div>

          <div style={{ padding: '1.5rem 2rem' }}>
            <USMap
              selectedState={selectedState}
              onStateSelect={state => setSelectedState(state)}
            />
          </div>

          {/* Legend */}
          <div
            style={{
              padding: '0 2rem 1.5rem',
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
            }}
          >
            <LegendItem color="var(--cream-darker)" label="Available" />
            <LegendItem color="var(--amber-soft)" label="Hover" />
            <LegendItem color="var(--amber)" label="Selected" />
          </div>
        </div>

        {/* Right: Store search */}
        <div
          style={{
            padding: '1.5rem 2rem',
            minHeight: 500,
          }}
        >
          <StoreSearch selectedState={selectedState} />
        </div>
      </div>

      {/* Footer note */}
      <div
        style={{
          borderTop: '1px solid var(--cream-dark)',
          padding: '1.25rem 2rem',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.6rem',
            color: 'var(--ink-muted)',
            letterSpacing: '0.04em',
            lineHeight: 1.7,
          }}
        >
          Product prices sourced live from traderjoes.com via their public GraphQL API. Prices
          reflect current listed prices and may vary by store. Store locations via Brandify. Price
          history will accumulate as the distributed crawler runs daily.
        </p>
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <div
        style={{
          width: 12,
          height: 12,
          background: color,
          border: '1px solid var(--cream-darker)',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: '0.58rem',
          color: 'var(--ink-muted)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  )
}
