export interface EIAConfig {
  dataset: string                  // EIA v2 dataset path, e.g. 'petroleum/pri/gnd'
  facets: Record<string, string>   // query facets, e.g. { product: 'EPM0', duoarea: 'NUS' }
  frequency: 'weekly' | 'monthly'
}

export interface Category {
  slug: string
  label: string
  shortLabel: string
  emoji: string
  unit: string
  seriesId: string      // BLS series ID or unique key — used as mock data lookup key
  description: string
  source: 'bls' | 'ams' | 'eia'
  sourceId: string      // BLS series ID, AMS report ID, or EIA series ID
  commodity?: string    // AMS commodity filter
  amsPackage?: string   // AMS package size filter (e.g. 'Gallon', '1 lb')
  eiaConfig?: EIAConfig // EIA-specific fetch parameters (required when source === 'eia')
}

export const CATEGORIES: Category[] = [
  {
    slug: 'eggs',
    label: 'Eggs, Grade A Large',
    shortLabel: 'Eggs',
    emoji: '🥚',
    unit: '/doz',
    seriesId: 'APU0000708111',
    description: 'Average price of one dozen Grade A large eggs, national average.',
    source: 'bls',
    sourceId: 'APU0000708111',
  },
  {
    slug: 'milk',
    label: 'Whole Milk',
    shortLabel: 'Milk',
    emoji: '🥛',
    unit: '/gal',
    seriesId: 'APU0000709112',
    description: 'Average price per gallon of whole milk, fresh, fortified.',
    source: 'ams',
    sourceId: '2995',
    commodity: 'Milk',
    amsPackage: 'Gallon',
  },
  {
    slug: 'ground-beef',
    label: 'Ground Beef',
    shortLabel: 'Ground Beef',
    emoji: '🥩',
    unit: '/lb',
    seriesId: 'APU0000703112',
    description: 'Average price per pound of 100% beef ground chuck.',
    source: 'bls',
    sourceId: 'APU0000703112',
  },
  {
    slug: 'chicken',
    label: 'Chicken, Whole',
    shortLabel: 'Chicken',
    emoji: '🍗',
    unit: '/lb',
    seriesId: 'APU0000706111',
    description: 'Average price per pound of whole fresh chicken.',
    source: 'bls',
    sourceId: 'APU0000706111',
  },
  {
    slug: 'bread',
    label: 'White Bread',
    shortLabel: 'Bread',
    emoji: '🍞',
    unit: '/lb',
    seriesId: 'APU0000702111',
    description: 'Average price per pound of white pan bread.',
    source: 'bls',
    sourceId: 'APU0000702111',
  },
  {
    slug: 'butter',
    label: 'Butter, Grade AA',
    shortLabel: 'Butter',
    emoji: '🧈',
    unit: '/lb',
    seriesId: 'APU0000FS1101',
    description: 'Average price per pound of salted Grade AA butter.',
    source: 'ams',
    sourceId: '2995',
    commodity: 'Butter',
    amsPackage: '1 lb',
  },
  {
    slug: 'coffee',
    label: 'Coffee, Ground Roast',
    shortLabel: 'Coffee',
    emoji: '☕',
    unit: '/lb',
    seriesId: 'APU0000717311',
    description: 'Average price per pound of 100% ground roast coffee.',
    source: 'bls',
    sourceId: 'APU0000717311',
  },
  {
    slug: 'orange-juice',
    label: 'Orange Juice',
    shortLabel: 'OJ',
    emoji: '🍊',
    unit: '/16oz',
    seriesId: 'APU0000713111',
    description: 'Average price per 16 oz of frozen concentrate orange juice.',
    source: 'bls',
    sourceId: 'APU0000713111',
  },
  {
    slug: 'gasoline',
    label: 'Gasoline, Unleaded Regular',
    shortLabel: 'Gasoline',
    emoji: '⛽',
    unit: '/gal',
    seriesId: 'APU000074714',
    description: 'Average retail price per gallon of unleaded regular gasoline.',
    source: 'eia',
    sourceId: 'EMM_EPMRR_PTE_NUS_DPG',
    eiaConfig: {
      dataset: 'petroleum/pri/gnd',
      facets: { product: 'EPM0', duoarea: 'NUS' },
      frequency: 'weekly',
    },
  },
  {
    slug: 'electricity',
    label: 'Electricity',
    shortLabel: 'Electricity',
    emoji: '⚡',
    unit: '/kWh',
    seriesId: 'APU000072610',
    description: 'Average price per kilowatt-hour of electricity.',
    source: 'bls',
    sourceId: 'APU000072610',
  },
  {
    slug: 'tomatoes',
    label: 'Tomatoes, Field Grown',
    shortLabel: 'Tomatoes',
    emoji: '🍅',
    unit: '/lb',
    seriesId: 'APU0000712311',
    description: 'Average price per pound of field-grown tomatoes.',
    source: 'bls',
    sourceId: 'APU0000712311',
  },
  {
    slug: 'potatoes',
    label: 'Potatoes, White',
    shortLabel: 'Potatoes',
    emoji: '🥔',
    unit: '/lb',
    seriesId: 'APU0000711211',
    description: 'Average price per pound of white potatoes.',
    source: 'bls',
    sourceId: 'APU0000711211',
  },
  // ── New categories ──────────────────────────────────────────────────────────
  {
    slug: 'rice',
    label: 'Rice, White Long Grain',
    shortLabel: 'Rice',
    emoji: '🍚',
    unit: '/lb',
    seriesId: 'APU0000701312',
    description: 'Average price per pound of white long grain rice, precooked.',
    source: 'bls',
    sourceId: 'APU0000701312',
  },
  {
    slug: 'flour',
    label: 'Flour, White All Purpose',
    shortLabel: 'Flour',
    emoji: '🌾',
    unit: '/5 lb',
    seriesId: 'APU0000701111',
    description: 'Average price per 5-lb bag of white all purpose flour.',
    source: 'bls',
    sourceId: 'APU0000701111',
  },
  {
    slug: 'apples',
    label: 'Apples, Red Delicious',
    shortLabel: 'Apples',
    emoji: '🍎',
    unit: '/lb',
    seriesId: 'APU0000711111',
    description: 'Average price per pound of Red Delicious apples.',
    source: 'bls',
    sourceId: 'APU0000711111',
  },
  {
    slug: 'natural-gas',
    label: 'Natural Gas, Residential',
    shortLabel: 'Natural Gas',
    emoji: '🔥',
    unit: '/Mcf',
    seriesId: 'EIA_NATGAS_RES',
    description: 'Average residential price per thousand cubic feet of natural gas.',
    source: 'eia',
    sourceId: 'NG_N3010US3_M',
    eiaConfig: {
      dataset: 'natural-gas/pri/sum',
      facets: { duoarea: 'NUS', process: 'PRS' },
      frequency: 'monthly',
    },
  },
  {
    slug: 'diesel',
    label: 'Diesel, No. 2',
    shortLabel: 'Diesel',
    emoji: '🚛',
    unit: '/gal',
    seriesId: 'EIA_DIESEL_NUS',
    description: 'Average retail price per gallon of No. 2 diesel fuel, national average.',
    source: 'eia',
    sourceId: 'EMM_EPD2DXL0_PTE_NUS_DPG',
    eiaConfig: {
      dataset: 'petroleum/pri/gnd',
      facets: { product: 'EPD2D', duoarea: 'NUS' },
      frequency: 'weekly',
    },
  },
]

export function getCategoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find(c => c.slug === slug)
}
