import type { PriceData } from './bls'

// Generates a 24-month price series with a trend and some noise
function makeSeries(
  base: number,
  trend: number,        // monthly % drift
  volatility: number,   // noise amplitude as fraction of base
  seed: number
): { date: string; value: number }[] {
  const points: { date: string; value: number }[] = []
  const now = new Date()
  // Start 24 months ago
  const startDate = new Date(now)
  startDate.setMonth(startDate.getMonth() - 23)

  let price = base
  // Simple seeded pseudo-random using xorshift
  let rng = seed
  function rand(): number {
    rng ^= rng << 13
    rng ^= rng >> 17
    rng ^= rng << 5
    return (((rng >>> 0) % 1000) / 1000 - 0.5) * 2 // -1 to 1
  }

  for (let i = 0; i < 24; i++) {
    const d = new Date(startDate)
    d.setMonth(d.getMonth() + i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    price = price * (1 + trend) + rand() * volatility * base
    price = Math.max(price, base * 0.4) // floor at 40% of base
    points.push({ date: `${yyyy}-${mm}`, value: Math.round(price * 100) / 100 })
  }
  return points
}

function buildPriceData(
  seriesId: string,
  base: number,
  trend: number,
  volatility: number,
  seed: number
): PriceData {
  const history = makeSeries(base, trend, volatility, seed)
  const current = history[history.length - 1].value
  const prev3m = history[history.length - 4]?.value ?? history[0].value
  const prev12m = history[history.length - 13]?.value ?? history[0].value
  return {
    seriesId,
    current,
    prev3m,
    prev12m,
    pctChange3m: ((current - prev3m) / prev3m) * 100,
    pctChange12m: ((current - prev12m) / prev12m) * 100,
    history,
  }
}

// Realistic mock data keyed by BLS series ID
export const MOCK_DATA: Record<string, PriceData> = {
  // Eggs — high volatility, currently elevated
  APU0000708111: buildPriceData('APU0000708111', 4.9, 0.004, 0.08, 42),
  // Whole milk — stable, slight upward
  APU0000709112: buildPriceData('APU0000709112', 3.95, 0.002, 0.02, 17),
  // Ground beef — slowly rising
  APU0000703112: buildPriceData('APU0000703112', 5.85, 0.003, 0.025, 99),
  // Chicken — moderate inflation
  APU0000706111: buildPriceData('APU0000706111', 1.92, 0.003, 0.03, 55),
  // Bread — stable
  APU0000702111: buildPriceData('APU0000702111', 2.15, 0.002, 0.015, 33),
  // Butter — volatile
  APU0000FS1101: buildPriceData('APU0000FS1101', 4.50, 0.004, 0.06, 77),
  // Coffee — rising sharply
  APU0000717311: buildPriceData('APU0000717311', 6.80, 0.008, 0.04, 11),
  // OJ — rising
  APU0000713111: buildPriceData('APU0000713111', 4.70, 0.006, 0.05, 88),
  // Gasoline — volatile
  APU000074714: buildPriceData('APU000074714', 3.40, 0.001, 0.07, 66),
  // Electricity — slowly rising
  APU000072610: buildPriceData('APU000072610', 0.158, 0.003, 0.015, 44),
  // Tomatoes — seasonal volatility
  APU0000712311: buildPriceData('APU0000712311', 1.95, 0.000, 0.09, 22),
  // Potatoes — slight deflation
  APU0000711211: buildPriceData('APU0000711211', 0.88, -0.001, 0.03, 15),
  // Rice — slowly rising, supply chain sensitivity
  APU0000701312: buildPriceData('APU0000701312', 1.28, 0.003, 0.025, 37),
  // Flour — Ukraine war spike, now normalizing
  APU0000701111: buildPriceData('APU0000701111', 4.10, 0.002, 0.03, 58),
  // Apples — stable with seasonal variation
  APU0000711111: buildPriceData('APU0000711111', 1.72, 0.001, 0.07, 83),
  // Natural gas — high seasonal volatility
  EIA_NATGAS_RES: buildPriceData('EIA_NATGAS_RES', 13.40, 0.002, 0.09, 29),
  // Diesel — closely tracks goods inflation
  EIA_DIESEL_NUS: buildPriceData('EIA_DIESEL_NUS', 3.78, 0.002, 0.065, 94),
}

// Mock TJ's products for a given search query
export interface MockProduct {
  sku: string
  name: string
  price: number
  category: string
  size: string
}

const TJ_PRODUCTS: MockProduct[] = [
  { sku: '025735', name: 'Organic Brown Eggs, 1 Dozen', price: 4.99, category: 'Dairy & Eggs', size: '12 ct' },
  { sku: '035785', name: 'Free Range Large White Eggs', price: 3.49, category: 'Dairy & Eggs', size: '12 ct' },
  { sku: '040822', name: 'Cage Free Large Eggs', price: 2.99, category: 'Dairy & Eggs', size: '18 ct' },
  { sku: '015671', name: 'Organic Whole Milk', price: 5.49, category: 'Dairy & Eggs', size: '1 gal' },
  { sku: '029314', name: 'Whole Milk', price: 3.79, category: 'Dairy & Eggs', size: '1 gal' },
  { sku: '019872', name: '2% Reduced Fat Milk', price: 3.59, category: 'Dairy & Eggs', size: '1 gal' },
  { sku: '012540', name: 'Organic Ground Beef 85/15', price: 7.49, category: 'Meat & Poultry', size: '1 lb' },
  { sku: '033421', name: 'Ground Beef 80/20', price: 5.99, category: 'Meat & Poultry', size: '1 lb' },
  { sku: '028714', name: 'Just Chicken Breast Strips', price: 4.49, category: 'Meat & Poultry', size: '12 oz' },
  { sku: '041233', name: 'Organic Chicken Thighs', price: 6.99, category: 'Meat & Poultry', size: '1.5 lb' },
  { sku: '031045', name: 'Sourdough Bread', price: 3.99, category: 'Bread & Bakery', size: '24 oz' },
  { sku: '022819', name: 'Sprouted Wheat Bread', price: 4.49, category: 'Bread & Bakery', size: '24 oz' },
  { sku: '027531', name: 'Salted Butter', price: 4.99, category: 'Dairy & Eggs', size: '1 lb' },
  { sku: '038411', name: 'Unsalted European Style Butter', price: 5.49, category: 'Dairy & Eggs', size: '1 lb' },
  { sku: '019043', name: 'Fair Trade Organic Coffee', price: 8.99, category: 'Beverages', size: '13 oz' },
  { sku: '024571', name: 'Cold Brew Coffee Concentrate', price: 6.99, category: 'Beverages', size: '32 oz' },
  { sku: '034812', name: 'Orange Juice, No Pulp', price: 4.29, category: 'Beverages', size: '52 oz' },
  { sku: '041509', name: 'Organic Tomatoes on the Vine', price: 3.99, category: 'Produce', size: '~1 lb' },
  { sku: '027643', name: 'Heirloom Cherry Tomatoes', price: 3.49, category: 'Produce', size: '1 pint' },
  { sku: '033012', name: 'Russet Potatoes', price: 2.99, category: 'Produce', size: '5 lb bag' },
  { sku: '028851', name: 'Baby Dutch Yellow Potatoes', price: 2.49, category: 'Produce', size: '1.5 lb' },
]

export function searchMockProducts(query: string): MockProduct[] {
  const q = query.toLowerCase().trim()
  if (!q) return TJ_PRODUCTS.slice(0, 8)
  return TJ_PRODUCTS.filter(
    p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
  ).slice(0, 10)
}

export function getMockHistory(sku: string): { date: string; price: number }[] {
  const product = TJ_PRODUCTS.find(p => p.sku === sku)
  if (!product) return []
  // Return a single current price point — backfill is future work
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return [{ date: `${yyyy}-${mm}`, price: product.price }]
}
