import { floorToChaos, type Floor } from '../shared/ledger'

export type GemType = 'skill' | 'support' | 'exceptional'

export type GemRow = {
  name: string
  type: GemType
  color: string | null
  buyLevel: number
  sellLevel: number
  xpMultiplier: number
  hasBuyCost: boolean
  buyFloors: Floor | null
  buyListings: number
  sellLowFloors: Floor | null
  sellLowListings: number
  sellHighFloors: Floor | null
  sellHighListings: number
}

export type GemVolume = { low: number; high: number }

export type GemLevelingData = {
  league: string
  normalXp: number
  exceptionalXp: number
  xpRatio: number
  gcpFloors: Floor
  gems: GemRow[]
  volume: Record<string, GemVolume>
}

export type GemRecommendation = '0q' | '20q' | 'skip'

export type GemComputedRow = {
  gem: GemRow
  buy: number | null
  low0q: number | null
  lowListings: number
  lowVolume: number
  high20q: number | null
  highListings: number
  highVolume: number
  profit0q: number | null
  profit20q: number | null
  normProfit0q: number | null
  normProfit20q: number | null
  bestNormProfit: number | null
  recommend: GemRecommendation
  belowThreshold: boolean
}

export type ComputeRowsOptions = {
  gcpPrice: number
  gcpsNeeded: number
  cpd: number
  mirrorDiv?: number
  minListings: number
  minVolume: number
}

export function computeRows(data: GemLevelingData, opts: ComputeRowsOptions): GemComputedRow[] {
  const { gcpPrice, gcpsNeeded, cpd, mirrorDiv = 380, minListings, minVolume } = opts

  return data.gems.map((gem) => {
    const buy = gem.hasBuyCost ? floorToChaos(gem.buyFloors, cpd, mirrorDiv) : 0
    const low0q = floorToChaos(gem.sellLowFloors, cpd, mirrorDiv)
    const high20q = floorToChaos(gem.sellHighFloors, cpd, mirrorDiv)
    const vol = data.volume[gem.name] ?? { low: 0, high: 0 }

    const profit0q = buy != null && low0q != null ? low0q - buy : null
    // 20q path also spends `gcpsNeeded` Gemcutter's Prisms to hit 20% quality.
    const profit20q = buy != null && high20q != null ? high20q - buy - gcpsNeeded * gcpPrice : null

    // Normalize by XP cost so exceptional gems (1->3, ~4.88x the XP of a normal
    // gem's 1->20) are compared fairly against normal skill/support gems.
    const xp = gem.xpMultiplier > 0 ? gem.xpMultiplier : 1
    const normProfit0q = profit0q != null ? profit0q / xp : null
    const normProfit20q = profit20q != null ? profit20q / xp : null

    let recommend: GemRecommendation = 'skip'
    let bestNormProfit: number | null = null
    if (normProfit0q != null || normProfit20q != null) {
      const p0 = normProfit0q ?? Number.NEGATIVE_INFINITY
      const p20 = normProfit20q ?? Number.NEGATIVE_INFINITY
      bestNormProfit = Math.max(p0, p20)
      recommend = bestNormProfit <= 0 ? 'skip' : p20 >= p0 ? '20q' : '0q'
    }

    const belowThreshold =
      gem.sellLowListings < minListings ||
      gem.sellHighListings < minListings ||
      vol.low < minVolume ||
      vol.high < minVolume

    return {
      gem,
      buy,
      low0q,
      lowListings: gem.sellLowListings,
      lowVolume: vol.low,
      high20q,
      highListings: gem.sellHighListings,
      highVolume: vol.high,
      profit0q,
      profit20q,
      normProfit0q,
      normProfit20q,
      bestNormProfit,
      recommend,
      belowThreshold,
    }
  })
}
