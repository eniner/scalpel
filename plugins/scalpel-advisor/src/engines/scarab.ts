/**
 * Scarab Atlas engine — ported from the Perandus Ledger scarab-calculator.
 * Atlas mode only (no Phrecia idols). See docs/stub-tools-research.md §4.
 */

export type ScarabAtlasModifier = 'blockable' | 'boostable' | 'none'

export type Scarab = {
  id: string
  name: string
  weight: number
  signature: string
  untradeable: boolean
}

export type ScarabCategory = {
  id: string
  name: string
  atlasModifier: ScarabAtlasModifier
  investmentBoost: boolean
  scarabs: Scarab[]
}

export type ScarabsRef = { categories: ScarabCategory[] }

/** Display order matching the in-game vendor/stash UI (from scarab_weights_preadjustment.txt). */
export const VENDOR_CATEGORY_ORDER = [
  'titanic', 'sulphite', 'divination', 'anarchy', 'ritual', 'harvest',
  'kalguuran', 'influencing', 'bestiary', 'trarthan', 'betrayal', 'incursion',
  'domination', 'torment', 'cartography', 'beyond', 'ambush', 'ultimatum',
  'expedition', 'delirium', 'legion', 'blight', 'abyss', 'essence', 'breach',
  'misc', 'horned',
]

export const MAX_SEARCH_STRING_LENGTH = 248

export type ScarabPriceLookup = (scarab: Scarab) => number | null

/** Remarkable Relics (Atlas keystone) compresses weight variance via weight^0.9. */
export function getEffectiveWeight(
  scarab: Scarab,
  weightOverrides: Record<string, number>,
  remarkableRelics: boolean,
): number {
  let weight = weightOverrides[scarab.id] ?? scarab.weight
  if (remarkableRelics && weight > 0) weight = Math.pow(weight, 0.9)
  return weight
}

export function getEffectivePrice(
  scarab: Scarab,
  priceFor: ScarabPriceLookup,
  priceOverrides: Record<string, number>,
): number {
  if (priceOverrides[scarab.id] !== undefined) return priceOverrides[scarab.id]
  return priceFor(scarab) ?? 0
}

export function calculateCategoryEV(
  cat: ScarabCategory,
  priceFor: ScarabPriceLookup,
  priceOverrides: Record<string, number>,
  weightOverrides: Record<string, number>,
  remarkableRelics: boolean,
): number {
  let totalWeight = 0
  let totalValue = 0
  for (const s of cat.scarabs) {
    const w = getEffectiveWeight(s, weightOverrides, remarkableRelics)
    totalWeight += w
    totalValue += w * getEffectivePrice(s, priceFor, priceOverrides)
  }
  return totalWeight > 0 ? totalValue / totalWeight : 0
}

export type ScarabCategoryEV = { category: ScarabCategory; ev: number; multiplier: number; blocked: boolean }

export type ScarabPoolOptions = {
  categories: ScarabCategory[]
  priceFor: ScarabPriceLookup
  priceOverrides?: Record<string, number>
  weightOverrides?: Record<string, number>
  remarkableRelics?: boolean
  blocked: Set<string>
  boosted: Set<string>
  invested: Set<string>
}

export type ScarabPoolResult = {
  poolEV: number
  /** Raw-weight EV (no Remarkable Relics/blocks/boosts) — the vendor-recipe random-scarab EV. */
  baselineEV: number
  categories: ScarabCategoryEV[]
}

export function computeScarabPool(opts: ScarabPoolOptions): ScarabPoolResult {
  const priceOverrides = opts.priceOverrides ?? {}
  const weightOverrides = opts.weightOverrides ?? {}
  const remarkableRelics = opts.remarkableRelics ?? true

  let totalWeight = 0
  let totalValue = 0
  const categories: ScarabCategoryEV[] = []
  for (const cat of opts.categories) {
    const catEV = calculateCategoryEV(cat, opts.priceFor, priceOverrides, weightOverrides, remarkableRelics)
    const blocked = opts.blocked.has(cat.id)
    let multiplier = 1
    if (!blocked) {
      if (opts.boosted.has(cat.id)) multiplier *= 2
      if (opts.invested.has(cat.id)) multiplier *= 1.5
    }
    categories.push({ category: cat, ev: catEV, multiplier, blocked })
    if (blocked) continue
    for (const s of cat.scarabs) {
      const w = getEffectiveWeight(s, weightOverrides, remarkableRelics) * multiplier
      totalWeight += w
      totalValue += w * getEffectivePrice(s, opts.priceFor, priceOverrides)
    }
  }
  const poolEV = totalWeight > 0 ? totalValue / totalWeight : 0

  let rawWeight = 0
  let rawValue = 0
  for (const cat of opts.categories) {
    for (const s of cat.scarabs) {
      const w = weightOverrides[s.id] ?? s.weight
      rawWeight += w
      rawValue += w * getEffectivePrice(s, opts.priceFor, priceOverrides)
    }
  }
  const baselineEV = rawWeight > 0 ? rawValue / rawWeight : 0

  return { poolEV, baselineEV, categories }
}

export type ScarabOptimalStrategy = {
  blocks: string[]
  boosts: string[]
  investments: string[]
  ev: number
}

/** Greedy heuristic ported from calculateOptimalStrategy(): block drag-down categories, then greedily boost/invest. */
export function computeOptimalStrategy(opts: {
  categories: ScarabCategory[]
  priceFor: ScarabPriceLookup
  priceOverrides?: Record<string, number>
  weightOverrides?: Record<string, number>
  remarkableRelics?: boolean
}): ScarabOptimalStrategy {
  const priceOverrides = opts.priceOverrides ?? {}
  const weightOverrides = opts.weightOverrides ?? {}
  const remarkableRelics = opts.remarkableRelics ?? true
  const catEV = (cat: ScarabCategory) =>
    calculateCategoryEV(cat, opts.priceFor, priceOverrides, weightOverrides, remarkableRelics)

  const evForConfig = (blocks: Set<string>, boosts: Set<string>, invests: Set<string>): number => {
    let w = 0
    let v = 0
    for (const cat of opts.categories) {
      if (blocks.has(cat.id)) continue
      let mult = 1
      if (boosts.has(cat.id)) mult *= 2
      if (invests.has(cat.id)) mult *= 1.5
      for (const s of cat.scarabs) {
        const weight = getEffectiveWeight(s, weightOverrides, remarkableRelics) * mult
        w += weight
        v += weight * getEffectivePrice(s, opts.priceFor, priceOverrides)
      }
    }
    return w > 0 ? v / w : 0
  }

  const blockable = opts.categories.filter((c) => c.atlasModifier === 'blockable')
  const boostable = opts.categories.filter((c) => c.atlasModifier === 'boostable')
  const investable = opts.categories.filter((c) => c.investmentBoost)

  let poolEV = evForConfig(new Set(), new Set(), new Set())
  const blocks = new Set<string>()
  for (const cat of blockable) {
    if (catEV(cat) < poolEV) blocks.add(cat.id)
  }
  poolEV = evForConfig(blocks, new Set(), new Set())

  const boostCandidates = boostable
    .filter((c) => !blocks.has(c.id))
    .map((c) => ({ id: c.id, ev: catEV(c) }))
    .sort((a, b) => b.ev - a.ev)

  const boosts = new Set<string>()
  let currentEV = poolEV
  for (const cand of boostCandidates) {
    if (cand.ev > currentEV) {
      boosts.add(cand.id)
      currentEV = evForConfig(blocks, boosts, new Set())
    } else break
  }

  const investCandidates = investable
    .filter((c) => !blocks.has(c.id))
    .map((c) => ({ id: c.id, ev: catEV(c) }))
    .sort((a, b) => b.ev - a.ev)

  const invests = new Set<string>()
  for (const cand of investCandidates) {
    if (cand.ev > currentEV) {
      invests.add(cand.id)
      currentEV = evForConfig(blocks, boosts, invests)
    } else break
  }

  return { blocks: [...blocks], boosts: [...boosts], investments: [...invests], ev: currentEV }
}

export type VendorScarabRow = {
  scarab: Scarab
  category: ScarabCategory
  price: number
  profit: number
}

export type VendorGuideResult = {
  rawBaselineEV: number
  vendorThreshold: number
  rows: VendorScarabRow[]
  searchString: string
  includedCount: number
  totalVendorable: number
  missingSignatureCount: number
}

/** Vendor Recipe: sell any 3 scarabs -> 1 random scarab (worth rawBaselineEV). Vendor threshold = rawBaselineEV / 3. */
export function buildVendorGuide(opts: {
  categories: ScarabCategory[]
  priceFor: ScarabPriceLookup
  priceOverrides?: Record<string, number>
  weightOverrides?: Record<string, number>
}): VendorGuideResult {
  const priceOverrides = opts.priceOverrides ?? {}
  const weightOverrides = opts.weightOverrides ?? {}

  let rawWeight = 0
  let rawValue = 0
  for (const cat of opts.categories) {
    for (const s of cat.scarabs) {
      const w = weightOverrides[s.id] ?? s.weight
      rawWeight += w
      rawValue += w * getEffectivePrice(s, opts.priceFor, priceOverrides)
    }
  }
  const rawBaselineEV = rawWeight > 0 ? rawValue / rawWeight : 0
  const vendorThreshold = rawBaselineEV / 3

  const rows: VendorScarabRow[] = []
  let missingSignatureCount = 0
  for (const cat of opts.categories) {
    for (const s of cat.scarabs) {
      const price = getEffectivePrice(s, opts.priceFor, priceOverrides)
      if (price >= vendorThreshold) continue
      if (!s.signature && !s.untradeable) missingSignatureCount++
      rows.push({ scarab: s, category: cat, price, profit: rawBaselineEV - price * 3 })
    }
  }
  rows.sort((a, b) => b.profit - a.profit)

  const signatures: string[] = []
  let currentLength = 0
  let includedCount = 0
  for (const row of rows) {
    if (!row.scarab.signature || row.scarab.untradeable) continue
    const sig = row.scarab.signature
    const addLength = signatures.length === 0 ? sig.length : sig.length + 1
    if (currentLength + addLength <= MAX_SEARCH_STRING_LENGTH) {
      signatures.push(sig)
      currentLength += addLength
      includedCount++
    }
  }
  const searchString = signatures.length > 0 ? `"${signatures.join('|')}"` : '(no vendorable scarabs)'

  return {
    rawBaselineEV,
    vendorThreshold,
    rows,
    searchString,
    includedCount,
    totalVendorable: rows.length,
    missingSignatureCount,
  }
}
