import { lookupPrice } from './prices'

/** Trade-API currency keys → display names used in the ninja price map. */
const TRADE_CURRENCY_NAME: Record<string, string> = {
  divine: 'Divine Orb',
  chaos: 'Chaos Orb',
  exa: 'Exalted Orb',
  exalted: 'Exalted Orb',
  mirror: 'Mirror of Kalandra',
  alch: 'Orb of Alchemy',
  alt: 'Orb of Alteration',
  annul: 'Orb of Annulment',
  vaal: 'Vaal Orb',
  regal: 'Regal Orb',
  chance: 'Orb of Chance',
  transmute: 'Orb of Transmutation',
  aug: 'Orb of Augmentation',
}

/** Convert a trade listing price into divine orbs using Scalpel's ninja rates. */
export function listingAmountToDivine(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const key = currency.trim().toLowerCase()
  if (key === 'divine') return amount
  const name = TRADE_CURRENCY_NAME[key]
  if (!name) return null
  const info = lookupPrice(name, name)
  if (info?.divineValue != null && Number.isFinite(info.divineValue) && info.divineValue > 0) {
    return amount * info.divineValue
  }
  return null
}

export type TradePriceSummary = {
  /** Finite divine samples from priced listings. */
  pricesDivine: number[]
  cheapestDivine: number | null
  /**
   * Rough market ask: median of the cheapest few buyouts that matched the
   * search (same mins as Find upgrades). Items meeting those mins are worth
   * about this — better rolls may list higher.
   */
  estimateDivine: number | null
  pricedCount: number
}

/** Summarize listing divine samples into a rough estimate. */
export function summarizeDivineSamples(samples: number[]): TradePriceSummary {
  const pricesDivine = samples
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  if (pricesDivine.length === 0) {
    return { pricesDivine: [], cheapestDivine: null, estimateDivine: null, pricedCount: 0 }
  }
  const cheapestDivine = pricesDivine[0]!
  const window = pricesDivine.slice(0, Math.min(5, pricesDivine.length))
  const mid = Math.floor(window.length / 2)
  const estimateDivine =
    window.length % 2 === 1 ? window[mid]! : (window[mid - 1]! + window[mid]!) / 2
  return {
    pricesDivine,
    cheapestDivine,
    estimateDivine,
    pricedCount: pricesDivine.length,
  }
}
