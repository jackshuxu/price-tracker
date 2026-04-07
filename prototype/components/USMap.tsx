'use client'
import { useState } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { STATE_NAMES } from '@/lib/state-zips'

// Use US Atlas 10m topojson from CDN
const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

// Mapping of FIPS codes to state abbreviations
const FIPS_TO_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
}

interface USMapProps {
  selectedState: string | null
  onStateSelect: (abbr: string) => void
}

export default function USMap({ selectedState, onStateSelect }: USMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)

  function getFill(abbr: string): string {
    if (abbr === selectedState) return '#C4391C'
    if (abbr === hoveredState) return '#F5E6C8'
    return '#E4DBCA'
  }

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* Map hint */}
      {!selectedState && (
        <p
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            color: 'var(--ink-muted)',
            textTransform: 'uppercase',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          Click a state
        </p>
      )}

      <ComposableMap
        projection="geoAlbersUsa"
        style={{ width: '100%', height: 'auto' }}
        projectionConfig={{ scale: 1000 }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => {
              const fips = String(geo.id).padStart(2, '0')
              const abbr = FIPS_TO_ABBR[fips] ?? ''
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => abbr && onStateSelect(abbr)}
                  onMouseEnter={() => abbr && setHoveredState(abbr)}
                  onMouseLeave={() => setHoveredState(null)}
                  style={{
                    default: {
                      fill: getFill(abbr),
                      stroke: '#F0EAD9',
                      strokeWidth: 0.6,
                      outline: 'none',
                      cursor: 'pointer',
                      transition: 'fill 0.15s ease',
                    },
                    hover: {
                      fill: abbr === selectedState ? '#C4391C' : '#F5E6C8',
                      stroke: '#F0EAD9',
                      strokeWidth: 0.6,
                      outline: 'none',
                      cursor: 'pointer',
                    },
                    pressed: {
                      fill: '#A82C14',
                      stroke: '#F0EAD9',
                      strokeWidth: 0.6,
                      outline: 'none',
                    },
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Hovered state tooltip */}
      {hoveredState && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'var(--cream)',
            padding: '0.3rem 0.7rem',
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.65rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            borderRadius: 1,
          }}
        >
          {STATE_NAMES[hoveredState] ?? hoveredState}
        </div>
      )}
    </div>
  )
}
