/**
 * Beast Farming EV engine — ported from the Perandus Ledger beast-calculator.
 * Atlas-mode only (no Phrecia idol mods). See docs/stub-tools-research.md §3.
 */

export type Beast = {
  name: string
  classification: string
  count: number
  priceId: string | null
}

export type BeastsRef = {
  classifications: string[]
  beasts: Beast[]
  weights: Record<string, number>
}

const BASE_RED_BEASTS = 1
const BASE_YELLOW_BEASTS = 4.5
const HARVEST_BEAST_PREFIXES = ['Wild', 'Primal', 'Vivid']

function isHarvestBeast(beast: Beast): boolean {
  return HARVEST_BEAST_PREFIXES.some((p) => beast.name.startsWith(p))
}

/** Harvest beasts (Wild/Primal/Vivid) share a uniform average weight with a 2x multiplier (Vivid Vulture excluded). */
export function getEffectiveWeight(beast: Beast, allBeasts: Beast[]): number {
  if (isHarvestBeast(beast)) {
    const harvestBeasts = allBeasts.filter(isHarvestBeast)
    const totalHarvestWeight = harvestBeasts.reduce((sum, b) => sum + b.count, 0)
    const baseWeight = harvestBeasts.length > 0 ? totalHarvestWeight / harvestBeasts.length : beast.count
    return beast.name === 'Vivid Vulture' ? baseWeight : baseWeight * 2
  }
  return beast.count
}

export type BeastEffectiveSpawns = { effectiveRed: number; effectiveYellow: number }

/**
 * additionalRedPct / additionalYellow / yellowToRedPct are Atlas passive-tree bonuses.
 * additionalYellow is a flat beast count; the other two are percentages (0-100).
 */
export function getEffectiveSpawns(
  additionalRedPct: number,
  additionalYellow: number,
  yellowToRedPct: number,
): BeastEffectiveSpawns {
  const totalYellowBeforeConversion = BASE_YELLOW_BEASTS + additionalYellow
  const convertedToRed = totalYellowBeforeConversion * (yellowToRedPct / 100)
  const effectiveYellow = totalYellowBeforeConversion * (1 - yellowToRedPct / 100)
  const effectiveRed = BASE_RED_BEASTS + additionalRedPct / 100 + convertedToRed
  return { effectiveRed, effectiveYellow }
}

/** Two-Hearted Hunt: Atlas mode always rolls (100% chance), 50/50 split between the 10%/20% markup tiers. */
export function getThhRate(markup10Pct: number, markup20Pct: number): number {
  return 1.0 * 0.5 * (markup10Pct / 100 + markup20Pct / 100)
}

export function getTotalRedBeasts(opts: {
  effectiveRed: number
  herdQty: number
  hasDuplicating: boolean
  thhRate: number
  pairChancePct: number
}): number {
  const beastsBeforeBonus = opts.effectiveRed + opts.herdQty * 5
  const bonusMultiplier = 1 + opts.pairChancePct / 100 + opts.thhRate
  const copyMultiplier = opts.hasDuplicating ? 2 : 1
  return beastsBeforeBonus * bonusMultiplier * copyMultiplier
}

export function getTotalYellowBeasts(effectiveYellow: number, hasDuplicating: boolean): number {
  const copyMultiplier = hasDuplicating ? 2 : 1
  return effectiveYellow * copyMultiplier
}

export type BeastPriceLookup = (beast: Beast) => number | null
export type BeastClassificationBoosts = Record<string, boolean>

function boostMultFor(classification: string, boosts: BeastClassificationBoosts): number {
  return boosts[classification] ? 2 : 1
}

export type BeastDistributionRow = {
  beast: Beast
  weight: number
  boostMult: number
  probability: number
  price: number
  hasPrice: boolean
  discarded: boolean
  contribution: number
}

/** Full distribution over all beasts (probability computed against the whole pool, including discarded beasts). */
export function calculateBeastDistribution(
  beasts: Beast[],
  boosts: BeastClassificationBoosts,
  priceFor: BeastPriceLookup,
  discardBelow: number,
): BeastDistributionRow[] {
  let totalWeight = 0
  const weights = new Map<Beast, number>()
  for (const beast of beasts) {
    const w = getEffectiveWeight(beast, beasts) * boostMultFor(beast.classification, boosts)
    weights.set(beast, w)
    totalWeight += w
  }
  const rows: BeastDistributionRow[] = []
  for (const beast of beasts) {
    const weight = weights.get(beast) ?? 0
    const probability = totalWeight > 0 ? weight / totalWeight : 0
    const priceRaw = priceFor(beast)
    const hasPrice = priceRaw != null
    const price = priceRaw ?? 0
    const discarded = price < discardBelow
    rows.push({
      beast,
      weight,
      boostMult: boostMultFor(beast.classification, boosts),
      probability,
      price,
      hasPrice,
      discarded,
      contribution: discarded ? 0 : probability * price,
    })
  }
  return rows
}

/** EV per captured red beast, given classification boosts and a discard-below floor. */
export function calculateBeastEV(
  beasts: Beast[],
  boosts: BeastClassificationBoosts,
  priceFor: BeastPriceLookup,
  discardBelow: number,
): number {
  const rows = calculateBeastDistribution(beasts, boosts, priceFor, discardBelow)
  let ev = 0
  for (const row of rows) ev += row.contribution
  return ev
}

export type BeastAtlasBonuses = {
  additionalRedPct: number
  additionalYellow: number
  yellowToRedPct: number
  pairChancePct: number
}

export type BeastThhMarkup = {
  markup10Pct: number
  markup20Pct: number
}

export type BeastScarabConfig = {
  herdQty: number
  herdPrice: number
  duplicatingQty: number
  duplicatingPrice: number
}

export type BeastFarmOptions = {
  beasts: Beast[]
  classificationBoosts: BeastClassificationBoosts
  priceFor: BeastPriceLookup
  atlas: BeastAtlasBonuses
  thh: BeastThhMarkup
  scarabs: BeastScarabConfig
  yellowPrice: number
  discardBelow: number
  timePerMapSec: number
}

export type BeastFarmResult = {
  effectiveRed: number
  effectiveYellow: number
  thhRate: number
  totalRedBeasts: number
  totalYellowBeasts: number
  evPerRedBeast: number
  yellowValue: number
  scarabCost: number
  grossEvPerMap: number
  netEvPerMap: number
  netEvPerHour: number
  distribution: BeastDistributionRow[]
}

export function computeBeastFarm(opts: BeastFarmOptions): BeastFarmResult {
  const { effectiveRed, effectiveYellow } = getEffectiveSpawns(
    opts.atlas.additionalRedPct,
    opts.atlas.additionalYellow,
    opts.atlas.yellowToRedPct,
  )
  const thhRate = getThhRate(opts.thh.markup10Pct, opts.thh.markup20Pct)
  const hasDuplicating = opts.scarabs.duplicatingQty > 0
  const totalRedBeasts = getTotalRedBeasts({
    effectiveRed,
    herdQty: opts.scarabs.herdQty,
    hasDuplicating,
    thhRate,
    pairChancePct: opts.atlas.pairChancePct,
  })
  const totalYellowBeasts = getTotalYellowBeasts(effectiveYellow, hasDuplicating)

  const distribution = calculateBeastDistribution(
    opts.beasts,
    opts.classificationBoosts,
    opts.priceFor,
    opts.discardBelow,
  ).sort((a, b) => b.contribution - a.contribution)

  let evPerRedBeast = 0
  for (const row of distribution) evPerRedBeast += row.contribution

  const yellowValue = totalYellowBeasts * opts.yellowPrice
  const scarabCost =
    opts.scarabs.herdQty * opts.scarabs.herdPrice + opts.scarabs.duplicatingQty * opts.scarabs.duplicatingPrice
  const grossEvPerMap = evPerRedBeast * totalRedBeasts + yellowValue
  const netEvPerMap = grossEvPerMap - scarabCost
  const netEvPerHour = opts.timePerMapSec > 0 ? netEvPerMap * (3600 / opts.timePerMapSec) : 0

  return {
    effectiveRed,
    effectiveYellow,
    thhRate,
    totalRedBeasts,
    totalYellowBeasts,
    evPerRedBeast,
    yellowValue,
    scarabCost,
    grossEvPerMap,
    netEvPerMap,
    netEvPerHour,
    distribution,
  }
}

export type BeastOptimalConfig = {
  herdQty: number
  duplicatingQty: number
  boosts: BeastClassificationBoosts
  netEvPerMap: number
}

/** Brute-force search over herd (0-2) x duplicating (0/1) x every classification boost combo. */
export function optimizeBeastFarm(base: BeastFarmOptions, classifications: string[]): BeastOptimalConfig {
  const n = Math.min(classifications.length, 8)
  let best: BeastOptimalConfig | null = null
  for (let herd = 0; herd <= 2; herd++) {
    for (let dup = 0; dup <= 1; dup++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const boosts: BeastClassificationBoosts = {}
        for (let i = 0; i < n; i++) boosts[classifications[i]] = !!(mask & (1 << i))
        const result = computeBeastFarm({
          ...base,
          classificationBoosts: boosts,
          scarabs: { ...base.scarabs, herdQty: herd, duplicatingQty: dup },
        })
        if (!best || result.netEvPerMap > best.netEvPerMap) {
          best = { herdQty: herd, duplicatingQty: dup, boosts, netEvPerMap: result.netEvPerMap }
        }
      }
    }
  }
  return best ?? { herdQty: 0, duplicatingQty: 0, boosts: {}, netEvPerMap: 0 }
}
