export interface TJProduct {
  sku: string
  name: string
  price: number
  category: string
  size: string
}

export interface TJStore {
  storeCode: string
  name: string
  city: string
  state: string
  address: string
  zip: string
}

const TJ_GRAPHQL = 'https://www.traderjoes.com/api/graphql'
const BRANDIFY_API = 'https://alphaapi.brandify.com/rest/locatorsearch'
const BRANDIFY_APPKEY = '8BC3433A-60FC-11E3-991D-B2EE0C70A832'

const TJ_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://www.traderjoes.com',
  'Referer': 'https://www.traderjoes.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

const SEARCH_QUERY = `
  query SearchProducts($storeCode: String, $pageSize: Int, $currentPage: Int, $search: String) {
    products(
      filter: { store_code: { eq: $storeCode }, published: { eq: "1" } }
      search: $search
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      items {
        sku
        item_title
        retail_price
        sales_size
        sales_uom_description
        category_hierarchy { id name }
      }
      total_count
      page_info { current_page page_size total_pages }
    }
  }
`

export async function searchTJProducts(
  query: string,
  storeCode: string
): Promise<TJProduct[]> {
  const body = JSON.stringify({
    query: SEARCH_QUERY,
    variables: {
      storeCode,
      search: query,
      pageSize: 20,
      currentPage: 1,
    },
  })

  const res = await fetch(TJ_GRAPHQL, {
    method: 'POST',
    headers: TJ_HEADERS,
    body,
  })

  if (!res.ok) throw new Error(`TJ API HTTP ${res.status}`)

  const json = await res.json()
  const items = json?.data?.products?.items ?? []

  return items.map((item: Record<string, unknown>) => ({
    sku: String(item.sku ?? ''),
    name: String(item.item_title ?? ''),
    price: parseFloat(String(item.retail_price ?? '0')),
    category:
      Array.isArray(item.category_hierarchy) && item.category_hierarchy.length > 0
        ? String((item.category_hierarchy as Record<string, unknown>[])[0]?.name ?? 'Other')
        : 'Other',
    size: item.sales_size
      ? `${item.sales_size} ${item.sales_uom_description ?? ''}`.trim()
      : '',
  }))
}

export async function fetchTJStores(zipCode: string): Promise<TJStore[]> {
  const body = JSON.stringify({
    request: {
      appkey: BRANDIFY_APPKEY,
      formdata: {
        geoip: false,
        dataview: 'store_default',
        limit: 25,
        searchradius: '50',
        where: {
          and: {
            licensee: { distinctfrom: '1' },
          },
        },
        geolocs: {
          geoloc: [{ addressline: zipCode, country: 'US', latitude: '', longitude: '' }],
        },
      },
    },
  })

  const res = await fetch(BRANDIFY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (!res.ok) throw new Error(`Brandify HTTP ${res.status}`)

  const json = await res.json()
  const collections = json?.response?.collection ?? []

  return collections
    .map((s: Record<string, unknown>) => ({
      storeCode: String(s.clientkey ?? s.store_id ?? ''),
      name: `Trader Joe's ${s.city ?? ''}`.trim(),
      city: String(s.city ?? ''),
      state: String(s.state ?? ''),
      address: String(s.address1 ?? ''),
      zip: String(s.postalcode ?? ''),
    }))
    .filter((s: TJStore) => s.storeCode)
}
