import { NextResponse } from 'next/server'
import { fetchTJStores } from '@/lib/tj'
import { STATE_ZIPS } from '@/lib/state-zips'
import { listStoresFromDistribution } from '@/lib/tj-distribution'

const ALLOW_EXTERNAL_FALLBACK = process.env.TJ_API_ALLOW_EXTERNAL_FALLBACK !== '0'
const ALLOW_MOCK_FALLBACK = process.env.TJ_API_ALLOW_MOCK_FALLBACK !== '0'

// Fallback mock stores keyed by state abbreviation
const MOCK_STORES: Record<string, { storeCode: string; name: string; city: string; state: string; address: string; zip: string }[]> = {
  CA: [
    { storeCode: '31', name: "Trader Joe's Los Angeles", city: 'Los Angeles', state: 'CA', address: '263 S Arroyo Pkwy', zip: '91105' },
    { storeCode: '32', name: "Trader Joe's Pasadena", city: 'Pasadena', state: 'CA', address: '345 E Colorado Blvd', zip: '91101' },
    { storeCode: '181', name: "Trader Joe's San Francisco", city: 'San Francisco', state: 'CA', address: '401 Bay St', zip: '94133' },
  ],
  NY: [
    { storeCode: '546', name: "Trader Joe's Manhattan", city: 'New York', state: 'NY', address: '142 E 14th St', zip: '10003' },
    { storeCode: '547', name: "Trader Joe's Upper West Side", city: 'New York', state: 'NY', address: '2073 Broadway', zip: '10023' },
  ],
  IL: [
    { storeCode: '701', name: "Trader Joe's Chicago Lincoln Park", city: 'Chicago', state: 'IL', address: '667 W Diversey Pkwy', zip: '60614' },
    { storeCode: '702', name: "Trader Joe's Chicago Gold Coast", city: 'Chicago', state: 'IL', address: '44 E Ontario St', zip: '60611' },
  ],
  TX: [
    { storeCode: '452', name: "Trader Joe's Austin", city: 'Austin', state: 'TX', address: '4001 N Lamar Blvd', zip: '78756' },
    { storeCode: '453', name: "Trader Joe's Houston", city: 'Houston', state: 'TX', address: '3905 Westheimer Rd', zip: '77027' },
  ],
  MA: [
    { storeCode: '028', name: "Trader Joe's Boston", city: 'Boston', state: 'MA', address: '899 Boylston St', zip: '02115' },
    { storeCode: '029', name: "Trader Joe's Cambridge", city: 'Cambridge', state: 'MA', address: '748 Memorial Dr', zip: '02139' },
  ],
}

function getMockStores(stateAbbr: string) {
  return (
    MOCK_STORES[stateAbbr] ?? [
      {
        storeCode: '000',
        name: `Trader Joe's ${stateAbbr}`,
        city: STATE_ZIPS[stateAbbr]?.city ?? stateAbbr,
        state: stateAbbr,
        address: '1 Main St',
        zip: STATE_ZIPS[stateAbbr]?.zip ?? '00000',
      },
    ]
  )
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const state = (searchParams.get('state') ?? '').toUpperCase()

  if (!state || !STATE_ZIPS[state]) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const zip = STATE_ZIPS[state].zip

  try {
    const distributedStores = await listStoresFromDistribution(state)
    if (distributedStores.length > 0) {
      return NextResponse.json(distributedStores, { headers: { 'x-tj-data-source': 'distribution' } })
    }

    if (ALLOW_EXTERNAL_FALLBACK) {
      const stores = await fetchTJStores(zip)
      // Filter to state match if we got results
      const filtered = stores.filter(s => s.state === state || stores.length < 3)
      if (filtered.length > 0) {
        return NextResponse.json(filtered, { headers: { 'x-tj-data-source': 'external-brandify' } })
      }
    }

    if (ALLOW_MOCK_FALLBACK) {
      return NextResponse.json(getMockStores(state), { headers: { 'x-tj-data-source': 'mock' } })
    }

    return NextResponse.json(
      { error: 'Stores backend unavailable and fallback disabled' },
      { status: 503, headers: { 'x-tj-data-source': 'none' } },
    )
  } catch (err) {
    console.warn('Distribution/Brandify stores unavailable:', err)
    if (ALLOW_MOCK_FALLBACK) {
      return NextResponse.json(getMockStores(state), { headers: { 'x-tj-data-source': 'mock' } })
    }
    return NextResponse.json(
      { error: 'Stores backend unavailable and fallback disabled' },
      { status: 503, headers: { 'x-tj-data-source': 'none' } },
    )
  }
}
