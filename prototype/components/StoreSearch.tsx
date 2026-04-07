'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TrendChart from './TrendChart'
import { STATE_NAMES } from '@/lib/state-zips'

interface Store {
  storeCode: string
  name: string
  city: string
  state: string
  address: string
  zip: string
}

interface Product {
  sku: string
  name: string
  price: number
  category: string
  size: string
}

interface PricePoint {
  date: string
  price: number
}

interface StoreSearchProps {
  selectedState: string | null
}

export default function StoreSearch({ selectedState }: StoreSearchProps) {
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [loadingStores, setLoadingStores] = useState(false)

  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [searched, setSearched] = useState(false)

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [history, setHistory] = useState<PricePoint[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Load stores when state changes
  useEffect(() => {
    if (!selectedState) return
    setStores([])
    setSelectedStore(null)
    setProducts([])
    setSelectedProduct(null)
    setHistory([])
    setSearched(false)
    setQuery('')
    setLoadingStores(true)

    fetch(`/api/tj/stores?state=${selectedState}`)
      .then(r => r.json())
      .then((data: Store[]) => {
        setStores(data)
        if (data.length > 0) setSelectedStore(data[0])
      })
      .catch(console.error)
      .finally(() => setLoadingStores(false))
  }, [selectedState])

  // Focus search when store selected
  useEffect(() => {
    if (selectedStore) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [selectedStore])

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !selectedStore) return
    setLoadingProducts(true)
    setSearched(true)
    setSelectedProduct(null)
    setHistory([])

    try {
      const res = await fetch(
        `/api/tj/search?q=${encodeURIComponent(query)}&storeCode=${selectedStore.storeCode}`
      )
      const data: Product[] = await res.json()
      setProducts(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingProducts(false)
    }
  }, [query, selectedStore])

  const handleProductClick = async (product: Product) => {
    setSelectedProduct(product)
    setLoadingHistory(true)
    setHistory([])

    try {
      const res = await fetch(
        `/api/tj/history/${product.sku}/${selectedStore?.storeCode ?? '000'}`
      )
      const data: PricePoint[] = await res.json()
      setHistory(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingHistory(false)
    }
  }

  if (!selectedState) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          minHeight: 320,
          gap: '0.75rem',
        }}
      >
        <span style={{ fontSize: '2.5rem' }}>←</span>
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.7rem',
            color: 'var(--ink-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Select a state on the map
          <br />
          to find Trader Joe&apos;s stores
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%' }}>
      {/* State header */}
      <div>
        <h2
          style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif',
            fontSize: '1.8rem',
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
          }}
        >
          {STATE_NAMES[selectedState] ?? selectedState}
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.62rem',
            color: 'var(--amber)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginTop: '0.2rem',
          }}
        >
          Trader Joe&apos;s locations
        </p>
      </div>

      {/* Store selector */}
      {loadingStores ? (
        <LoadingPulse text="Finding stores..." />
      ) : stores.length > 0 ? (
        <select
          value={selectedStore?.storeCode ?? ''}
          onChange={e => {
            const s = stores.find(st => st.storeCode === e.target.value)
            if (s) setSelectedStore(s)
          }}
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.72rem',
            color: 'var(--ink)',
            background: 'var(--cream)',
            border: '1px solid var(--cream-darker)',
            padding: '0.5rem 0.75rem',
            cursor: 'pointer',
            appearance: 'none',
            WebkitAppearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%231C1814'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.75rem center',
            paddingRight: '2rem',
          }}
        >
          {stores.map(s => (
            <option key={s.storeCode} value={s.storeCode}>
              {s.city} — {s.address}
            </option>
          ))}
        </select>
      ) : (
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: '0.7rem',
            color: 'var(--ink-muted)',
          }}
        >
          No Trader Joe&apos;s found in this state.
        </p>
      )}

      {/* Search bar */}
      {selectedStore && (
        <div style={{ display: 'flex', gap: '0', border: '1px solid var(--cream-darker)' }}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search products... (eggs, milk, bread)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono), monospace',
              fontSize: '0.75rem',
              color: 'var(--ink)',
              background: 'var(--cream)',
              border: 'none',
              padding: '0.6rem 0.75rem',
              outline: 'none',
              letterSpacing: '0.02em',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim()}
            style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize: '0.65rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: query.trim() ? 'var(--ink)' : 'var(--cream-dark)',
              color: query.trim() ? 'var(--cream)' : 'var(--ink-muted)',
              border: 'none',
              padding: '0.6rem 1rem',
              cursor: query.trim() ? 'pointer' : 'default',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            Search
          </button>
        </div>
      )}

      {/* Results */}
      {loadingProducts && <LoadingPulse text="Searching products..." />}

      <AnimatePresence>
        {!loadingProducts && searched && products.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize: '0.7rem',
              color: 'var(--ink-muted)',
            }}
          >
            No products found for &ldquo;{query}&rdquo;
          </motion.p>
        )}

        {!loadingProducts && products.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cream-dark)' }}
          >
            {products.map(product => (
              <button
                key={product.sku}
                onClick={() => handleProductClick(product)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.65rem 0.85rem',
                  background:
                    selectedProduct?.sku === product.sku
                      ? 'var(--amber-soft)'
                      : 'var(--cream)',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                  borderLeft: selectedProduct?.sku === product.sku
                    ? '3px solid var(--amber)'
                    : '3px solid transparent',
                }}
              >
                <div>
                  <p
                    style={{
                      fontFamily: 'var(--font-lora), serif',
                      fontSize: '0.8rem',
                      color: 'var(--ink)',
                      lineHeight: 1.3,
                    }}
                  >
                    {product.name}
                  </p>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono), monospace',
                      fontSize: '0.6rem',
                      color: 'var(--ink-muted)',
                      marginTop: '0.1rem',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {product.category} · {product.size}
                  </p>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    marginLeft: '0.75rem',
                    flexShrink: 0,
                  }}
                >
                  ${product.price.toFixed(2)}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Price history chart for selected product */}
      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            style={{
              borderTop: '1px solid var(--cream-dark)',
              paddingTop: '1rem',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-fraunces), serif',
                fontSize: '0.95rem',
                fontWeight: 600,
                marginBottom: '0.25rem',
                lineHeight: 1.3,
              }}
            >
              {selectedProduct.name}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-mono), monospace',
                fontSize: '0.6rem',
                color: 'var(--amber)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
              }}
            >
              Price history · SKU {selectedProduct.sku}
            </p>

            {loadingHistory ? (
              <LoadingPulse text="Loading history..." />
            ) : history.length <= 1 ? (
              <div
                style={{
                  background: 'var(--cream-dark)',
                  padding: '1rem',
                  borderLeft: '3px solid var(--slate)',
                }}
              >
                <p
                  style={{
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: '0.65rem',
                    color: 'var(--ink-muted)',
                    lineHeight: 1.6,
                    letterSpacing: '0.03em',
                  }}
                >
                  Current price:{' '}
                  <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    ${selectedProduct.price.toFixed(2)}
                  </strong>
                  <br />
                  Historical backfill not yet available.
                  <br />
                  Price history will accumulate daily once the crawler runs.
                </p>
              </div>
            ) : (
              <TrendChart
                data={history.map(h => ({ date: h.date, value: h.price }))}
                unit=""
                height={200}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LoadingPulse({ text }: { text: string }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-mono), monospace',
        fontSize: '0.65rem',
        color: 'var(--ink-muted)',
        letterSpacing: '0.08em',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    >
      {text}
    </p>
  )
}
