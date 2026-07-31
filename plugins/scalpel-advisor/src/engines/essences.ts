/**
 * Essence Farming EV engine — ported from the Perandus Ledger essence-calculator
 * (closed-form transforms only; Adaptation's Monte-Carlo re-vaal simulation is out of scope).
 * See docs/stub-tools-research.md §5.
 */

export type EssenceGroup = {
  id: number
  essences: string[]
  maxTier: number
  corrupt: boolean
}

export type EssencesRef = {
  prices: Record<string, { chaos: number; divine: number | null; volume?: number }>
  weights: Record<string, number>
  totalWeight: number
  groups: EssenceGroup[]
  tiers: string[]
  scarabPrices: Record<string, { chaos: number; divine: number | null }>
}

export const BASE_ESS_PER_MONSTER = 2.5
const CRYSTAL_LATTICE_BONUS = 0.15
const GROUP6_ESSENCES = ['insanity', 'horror', 'delirium', 'hysteria']

function isGroup6Essence(essence: string): boolean {
  return GROUP6_ESSENCES.includes(essence)
}

/** Group-6 (corrupted-only) essences are tierless: "essence-of-horror". */
export function essenceId(tier: string, essence: string): string {
  if (isGroup6Essence(essence)) return `essence-of-${essence}`
  return `${tier}-essence-of-${essence}`
}

export type EssencePriceLookup = (id: string) => number | null

function getPrice(priceFor: EssencePriceLookup, tier: string, essence: string): number {
  return priceFor(essenceId(tier, essence)) ?? 0
}

/**
 * Valuation-adjusted price accounting for the 3:1 upgrade recipe (3 lower-tier essences -> 1 higher tier).
 * Group-6 (corrupted) essences always use market price since they have no natural tier chain.
 */
export function getValuationPrice(
  priceFor: EssencePriceLookup,
  valuation: EssenceValuationMode,
  tiers: string[],
  tier: string,
  essence: string,
): number {
  if (!isGroup6Essence(essence)) {
    const tierIdx = tiers.indexOf(tier)
    if (valuation === 'deafening') {
      if (tierIdx >= 1) {
        const deafeningPrice = getPrice(priceFor, 'deafening', essence)
        return deafeningPrice / Math.pow(3, tierIdx)
      }
    } else if (valuation === 'shrieking') {
      if (tierIdx >= 2) {
        const shriekingPrice = getPrice(priceFor, 'shrieking', essence)
        return shriekingPrice / Math.pow(3, tierIdx - 1)
      }
      if (tierIdx === 1) {
        const shriekingMarket = getPrice(priceFor, 'shrieking', essence)
        const deafeningPrice = getPrice(priceFor, 'deafening', essence)
        if (shriekingMarket * 3 <= deafeningPrice) return deafeningPrice / 3
      }
    }
  }
  return getPrice(priceFor, tier, essence)
}

export type EssenceValuationMode = 'all' | 'shrieking' | 'deafening'
export type EssenceVaalMode = 'none' | 'all' | 'meds'

/** Crystal Lattice: +15% chance of a bonus essence, +15% chance of a triple-bonus essence. */
export function getEssPerMonster(crystalLattice: boolean): number {
  const extra = crystalLattice ? CRYSTAL_LATTICE_BONUS : 0
  return BASE_ESS_PER_MONSTER + extra + extra * 3
}

export type EssencedMonsterInputs = {
  rareMonstersPerMap: number
  amplifiedEnergies: boolean
  prolificEssence: boolean
  calcificationQty: number
  adversariesQty: number
  essenceQty: number
}

export function getEssencedMonsters(opts: EssencedMonsterInputs): number {
  const totalRareMonsters = opts.rareMonstersPerMap + opts.adversariesQty * 4
  const baseEssenceMonsters = 0.08 + (opts.amplifiedEnergies ? 0.3 : 0)
  return (
    baseEssenceMonsters +
    (opts.prolificEssence ? 1 : 0) +
    (opts.calcificationQty > 0 ? totalRareMonsters : 0) +
    opts.essenceQty * 3
  )
}

/**
 * Amplified Energies (proportional weight transfer to Shrieking) then Ascent (shift every tier up by 1).
 * Approximation ported verbatim from the source — commented there as "rough" rather than exact drop math.
 */
export function getTransformedWeights(
  groups: EssenceGroup[],
  tiers: string[],
  weights: Record<string, number>,
  amplifiedEnergies: boolean,
  ascent: boolean,
  essPerMonster: number,
): Record<string, number> {
  let transformed: Record<string, number> = { ...weights }

  if (amplifiedEnergies) {
    let totalWeight = 0
    const tierWeights: Record<string, number> = {}
    for (const t of tiers) tierWeights[t] = 0
    for (const key of Object.keys(weights)) {
      const tier = key.split('|')[0]
      totalWeight += weights[key]
      tierWeights[tier] = (tierWeights[tier] || 0) + weights[key]
    }

    if (totalWeight > 0) {
      const pShrieking = (tierWeights['shrieking'] || 0) / totalWeight
      const upgradeRate = 1 / essPerMonster

      const next: Record<string, number> = {}
      for (const key of Object.keys(weights)) {
        const tier = key.split('|')[0]
        const baseWeight = weights[key]
        if (tier === 'shrieking' || tier === 'deafening') {
          next[key] = baseWeight
        } else {
          const lostWeight = baseWeight * upgradeRate * (1 - pShrieking)
          next[key] = Math.max(0, baseWeight - lostWeight)
        }
      }

      let totalLost = 0
      for (const key of Object.keys(weights)) {
        const tier = key.split('|')[0]
        if (tier !== 'shrieking' && tier !== 'deafening') {
          totalLost += weights[key] * upgradeRate * (1 - pShrieking)
        }
      }

      for (const group of groups) {
        if (group.corrupt) continue
        for (const essence of group.essences) {
          const shriekKey = `shrieking|${essence}`
          if (next[shriekKey] !== undefined) {
            next[shriekKey] = (next[shriekKey] || 0) + totalLost / 20
          }
        }
      }

      transformed = next
    }
  }

  if (ascent) {
    const shifted: Record<string, number> = {}
    for (const key of Object.keys(transformed)) {
      const [tier, essence] = key.split('|')
      const tierIdx = tiers.indexOf(tier)
      if (tierIdx > 0) {
        const newTier = tiers[tierIdx - 1]
        const newKey = `${newTier}|${essence}`
        shifted[newKey] = (shifted[newKey] || 0) + transformed[key]
      }
    }
    transformed = shifted
  }

  return transformed
}

export function calcShift(groups: EssenceGroup[], groupId: number, tierIdx: number): { groupId: number; tierIdx: number } {
  const newGroupId = Math.min(groupId + 1, 6)
  const newGroup = groups.find((g) => g.id === newGroupId)
  const newTierIdx = newGroup ? Math.min(tierIdx, newGroup.maxTier) : tierIdx
  return { groupId: newGroupId, tierIdx: newTierIdx }
}

export function calcUptier(tierIdx: number): number {
  return Math.max(tierIdx - 1, 0)
}

export function calculatePMEDS(
  groups: EssenceGroup[],
  tiers: string[],
  weights: Record<string, number>,
  essPerMonster: number,
): number {
  const group5 = groups.find((g) => g.id === 5)
  let totalWeight = 0
  for (const key of Object.keys(weights)) totalWeight += weights[key]
  if (!group5 || totalWeight <= 0) return 0
  let group5Weight = 0
  for (const essence of group5.essences) {
    for (let t = 0; t <= group5.maxTier; t++) {
      group5Weight += weights[`${tiers[t]}|${essence}`] || 0
    }
  }
  const p5 = group5Weight / totalWeight
  return 1 - Math.pow(1 - p5, essPerMonster)
}

export type EssenceDistRow = {
  id: string
  tier: string
  tierIdx: number
  essence: string
  groupId: number
  probability: number
  price: number
  valuedPrice: number
  contribution: number
  valuedContribution: number
}

/** Final post-vaal essence distribution. Ascent/Amplified Energies must already be baked into `weights`. */
export function calculateFinalDistribution(
  groups: EssenceGroup[],
  tiers: string[],
  weights: Record<string, number>,
  priceFor: EssencePriceLookup,
  valuation: EssenceValuationMode,
  vaalMode: EssenceVaalMode,
  useStability: boolean,
  essPerMonster: number,
): EssenceDistRow[] {
  let totalWeight = 0
  for (const key of Object.keys(weights)) totalWeight += weights[key]
  if (totalWeight <= 0) return []

  const toRow = (groupId: number, tierIdx: number, essence: string, probability: number): EssenceDistRow => {
    const tier = tiers[tierIdx]
    const price = getPrice(priceFor, tier, essence)
    const valuedPrice = getValuationPrice(priceFor, valuation, tiers, tier, essence)
    return {
      id: essenceId(tier, essence),
      tier,
      tierIdx,
      essence,
      groupId,
      probability,
      price,
      valuedPrice,
      contribution: probability * price,
      valuedContribution: probability * valuedPrice,
    }
  }

  if (vaalMode === 'none') {
    const rows: EssenceDistRow[] = []
    for (const group of groups) {
      for (const essence of group.essences) {
        for (let tierIdx = 0; tierIdx <= group.maxTier; tierIdx++) {
          const weight = weights[`${tiers[tierIdx]}|${essence}`] || 0
          if (weight === 0) continue
          rows.push(toRow(group.id, tierIdx, essence, weight / totalWeight))
        }
      }
    }
    return rows
  }

  const pMEDS = vaalMode === 'meds' ? calculatePMEDS(groups, tiers, weights, essPerMonster) : 1

  type Acc = { groupId: number; tierIdx: number; essence: string; probability: number }
  const finalDist = new Map<string, Acc>()
  const add = (groupId: number, tierIdx: number, essence: string, probability: number) => {
    const key = `${groupId}|${tierIdx}|${essence}`
    const existing = finalDist.get(key)
    if (existing) existing.probability += probability
    else finalDist.set(key, { groupId, tierIdx, essence, probability })
  }

  for (const group of groups) {
    for (const essence of group.essences) {
      for (let tierIdx = 0; tierIdx <= group.maxTier; tierIdx++) {
        const weight = weights[`${tiers[tierIdx]}|${essence}`] || 0
        if (weight === 0) continue
        const prob = weight / totalWeight

        const pVaal = vaalMode === 'meds' ? (group.id === 5 ? 1 : pMEDS) : 1
        const pNoVaal = 1 - pVaal
        if (pNoVaal > 0) add(group.id, tierIdx, essence, prob * pNoVaal)

        const vaaledProb = prob * pVaal
        const shifted = calcShift(groups, group.id, tierIdx)
        const targetGroup = groups.find((g) => g.id === shifted.groupId)
        const uptierIdx = calcUptier(tierIdx)

        if (useStability) {
          // 50% shift, 50% uptier
          if (targetGroup) {
            const shiftShare = (vaaledProb * 0.5) / targetGroup.essences.length
            for (const targetEssence of targetGroup.essences) add(shifted.groupId, shifted.tierIdx, targetEssence, shiftShare)
          }
          add(group.id, uptierIdx, essence, vaaledProb * 0.5)
        } else {
          // 50% nothing, 25% shift, 25% uptier
          add(group.id, tierIdx, essence, vaaledProb * 0.5)
          if (targetGroup) {
            const shiftShare = (vaaledProb * 0.25) / targetGroup.essences.length
            for (const targetEssence of targetGroup.essences) add(shifted.groupId, shifted.tierIdx, targetEssence, shiftShare)
          }
          add(group.id, uptierIdx, essence, vaaledProb * 0.25)
        }
      }
    }
  }

  return [...finalDist.values()].map((item) => toRow(item.groupId, item.tierIdx, item.essence, item.probability))
}

export type EssenceFarmOptions = {
  groups: EssenceGroup[]
  tiers: string[]
  weights: Record<string, number>
  priceFor: EssencePriceLookup
  valuation: EssenceValuationMode
  rareMonstersPerMap: number
  crystalLattice: boolean
  amplifiedEnergies: boolean
  prolificEssence: boolean
  crystalResonance: boolean
  ascentQty: number
  ascentPrice: number
  essenceQty: number
  essencePrice: number
  calcificationQty: number
  calcificationPrice: number
  adversariesQty: number
  adversariesPrice: number
  stabilityQty: number
  stabilityPrice: number
  vaalMode: EssenceVaalMode
  vaalOrbPrice: number
  timePerMapSec: number
}

export type EssenceFarmResult = {
  essPerMonster: number
  essencedMonsters: number
  totalEssences: number
  breakdown: EssenceDistRow[]
  baseEV: number
  totalEV: number
  vaalMultiplier: number
  scarabCost: number
  vaalCost: number
  totalCost: number
  evPerMap: number
  netProfitPerMap: number
  netProfitPerHour: number
}

export function computeEssenceFarm(opts: EssenceFarmOptions): EssenceFarmResult {
  const essPerMonster = getEssPerMonster(opts.crystalLattice)
  const essencedMonsters = getEssencedMonsters(opts)
  const crystalResonanceBonus = opts.crystalResonance ? essencedMonsters : 0
  const totalEssences = essencedMonsters * essPerMonster + crystalResonanceBonus

  const useAscent = opts.ascentQty > 0
  const useStability = opts.stabilityQty > 0
  // Crystal Resonance turns Vaaling into a zero-sum boss-only gamble, so it's mutually exclusive with map-wide Vaal EV.
  const vaalMode: EssenceVaalMode = opts.crystalResonance ? 'none' : opts.vaalMode

  const transformedWeights = getTransformedWeights(
    opts.groups,
    opts.tiers,
    opts.weights,
    opts.amplifiedEnergies,
    useAscent,
    essPerMonster,
  )

  const breakdown = calculateFinalDistribution(
    opts.groups,
    opts.tiers,
    transformedWeights,
    opts.priceFor,
    opts.valuation,
    vaalMode,
    useStability,
    essPerMonster,
  )

  let totalWeightT = 0
  for (const key of Object.keys(transformedWeights)) totalWeightT += transformedWeights[key]
  let baseEV = 0
  if (totalWeightT > 0) {
    for (const group of opts.groups) {
      for (const essence of group.essences) {
        for (let tierIdx = 0; tierIdx <= group.maxTier; tierIdx++) {
          const tier = opts.tiers[tierIdx]
          const w = transformedWeights[`${tier}|${essence}`] || 0
          if (w === 0) continue
          baseEV += (w / totalWeightT) * getValuationPrice(opts.priceFor, opts.valuation, opts.tiers, tier, essence)
        }
      }
    }
  }

  let totalEV = 0
  for (const row of breakdown) totalEV += row.valuedContribution
  const vaalMultiplier = baseEV > 0 ? totalEV / baseEV : 1

  const evPerMap = totalEV * totalEssences

  const scarabCost =
    opts.ascentQty * opts.ascentPrice +
    opts.essenceQty * opts.essencePrice +
    opts.calcificationQty * opts.calcificationPrice +
    opts.adversariesQty * opts.adversariesPrice +
    opts.stabilityQty * opts.stabilityPrice

  let vaalCost = 0
  if (vaalMode === 'all') {
    vaalCost = essencedMonsters * opts.vaalOrbPrice
  } else if (vaalMode === 'meds') {
    const pMEDS = calculatePMEDS(opts.groups, opts.tiers, transformedWeights, essPerMonster)
    vaalCost = essencedMonsters * pMEDS * opts.vaalOrbPrice
  }

  const totalCost = scarabCost + vaalCost
  const netProfitPerMap = evPerMap - totalCost
  const netProfitPerHour = opts.timePerMapSec > 0 ? netProfitPerMap * (3600 / opts.timePerMapSec) : 0

  return {
    essPerMonster,
    essencedMonsters,
    totalEssences,
    breakdown: breakdown.sort((a, b) => b.valuedContribution - a.valuedContribution),
    baseEV,
    totalEV,
    vaalMultiplier,
    scarabCost,
    vaalCost,
    totalCost,
    evPerMap,
    netProfitPerMap,
    netProfitPerHour,
  }
}
