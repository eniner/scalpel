/* Harvest Farming EV engine — pure math, no DOM access.
 * Ported 1:1 from `ref-harvest-engine.js` (verbatim `HarvestEngine.solve(...)`
 * behaviour). All functions are pure and side-effect free except for the
 * small in-module sequence cache mirroring the original `SEQUENCE_CACHE`.
 */

export const SEEDS_PER_PLOT = 23
export const YELLOW = 0
export const BLUE = 1
export const RED = 2

export const REDUCTIONS = [0, 10, 20, 25, 35, 45] as const
export const MULTIPLIER: Record<number, number> = { 0: 1.0, 10: 0.9, 20: 0.8, 25: 0.75, 35: 0.65, 45: 0.55 }
export const NODE_COUNT: Record<number, number> = { 0: 0, 10: 1, 20: 2, 25: 1, 35: 2, 45: 3 }
export const PHRECIA_REDUCTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const

// Mechanics tuning
export const BASE_EXTRA_PLOT_CHANCE = 0.5
export const MAP_QUANT_CONTRIBUTION = 0.5
export const ATLAS_EXTRA_PLOT_CHANCE = 0.5
export const AWAKENER_DUPLICATE_MONSTER = 0.5
export const AWAKENER_NOT_WILT = 0.5
export const DOUBLING_LIFEFORCE_MULT = 2.0

/** seedDist = { t4Chance, t3Slots, t3Prob, t2Slots, t2Prob } — resolved by caller. */
export type SeedDist = {
  t4Chance: number
  t3Slots: number
  t3Prob: number
  t2Slots: number
  t2Prob: number
}

/** params = { lfPerTier } — resolved by caller (LF yield per seed of each tier). */
export type HarvestParams = {
  lfPerTier: [number, number, number, number]
}

export type HarvestPrices = { y: number; b: number; r: number }

export type SeedConfig = { seeds: [number, number, number, number]; prob: number }
export type LfDistEntry = { lf123: number; lf4: number; prob: number }
export type PairLookupCell = {
  lfFirst123: [number, number, number]
  lfFirst4: [number, number, number]
  lfSecond123: [number, number, number]
  lfSecond4: [number, number, number]
}
/** Indexed [color1][bonus1][color2][bonus2]. */
export type PairLookup = PairLookupCell[][][][]

export type HarvestReductionConfig = { ry: number; rb: number; rr: number }

export type HarvestSolveOptions = {
  prices: HarvestPrices
  pairDist: Record<number, number>
  useAwakener: boolean
  useDoubling: boolean
  useCornucopia: boolean
  mapQuant: number
  packsize: number
  bonusLifeforce: number
  duplicateMonster: number
  notWilt: number
  duplicateLifeforce: number
  params: HarvestParams
  seedDist: SeedDist
  phreciaMode?: boolean
}

export type HarvestResultRow = {
  reductions: { yellow: number; blue: number; red: number }
  pointCostProxy: number
  expectedLf: [number, number, number]
  expectedValue: number
  weights: { y: number; b: number; r: number }
}

export type HarvestMeta = {
  useAwakener: boolean
  useDoubling: boolean
  useCornucopia: boolean
  notWiltChance: number
  qtyMult: number
  monsterMult: number
  lifeforceDupMult: number
  lfMult123: number
  lfMult4: number
  avgPairs: number
  avgPlotsHarvested: number
}

export type HarvestSolveResult = {
  meta: HarvestMeta | Record<string, never>
  top: HarvestResultRow[]
}

// ============ Seed configs ============

function binomProb(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0
  let coeff = 1
  for (let i = 0; i < k; i++) coeff *= (n - i) / (i + 1)
  return coeff * Math.pow(p, k) * Math.pow(1 - p, n - k)
}

export function generateSeedConfigs(seedDist: SeedDist): SeedConfig[] {
  const configs: SeedConfig[] = []
  for (let n4 = 0; n4 <= 1; n4++) {
    const p4 = n4 === 1 ? seedDist.t4Chance : 1 - seedDist.t4Chance
    for (let n3 = 0; n3 <= seedDist.t3Slots; n3++) {
      const p3 = binomProb(seedDist.t3Slots, n3, seedDist.t3Prob)
      for (let n2 = 0; n2 <= seedDist.t2Slots; n2++) {
        const p2 = binomProb(seedDist.t2Slots, n2, seedDist.t2Prob)
        const n1 = SEEDS_PER_PLOT - n4 - n3 - n2
        if (n1 < 0) continue
        const prob = p4 * p3 * p2
        if (prob > 0) configs.push({ seeds: [n1, n2, n3, n4], prob })
      }
    }
  }
  return configs
}

export function configToLf(
  config: SeedConfig,
  lfPerTier: [number, number, number, number],
): { lf123: number; lf4: number } {
  const [n1, n2, n3, n4] = config.seeds
  const lf123 = n1 * lfPerTier[0] + n2 * lfPerTier[1] + n3 * lfPerTier[2]
  const lf4 = n4 * lfPerTier[3]
  return { lf123, lf4 }
}

export function buildLfDistribution(
  lfPerTier: [number, number, number, number],
  seedDist: SeedDist,
): LfDistEntry[] {
  const configs = generateSeedConfigs(seedDist)
  return configs.map((c) => {
    const { lf123, lf4 } = configToLf(c, lfPerTier)
    return { lf123, lf4, prob: c.prob }
  })
}

// ============ Pair lookup ============

export function buildPairLookup(lfDist: LfDistEntry[], pricesPerLf: [number, number, number], t4Lf: number): PairLookup {
  const lookup: PairLookup = []
  for (let c1 = 0; c1 < 3; c1++) {
    lookup[c1] = []
    for (let b1 = 0; b1 <= 1; b1++) {
      lookup[c1][b1] = []
      for (let c2 = 0; c2 < 3; c2++) {
        lookup[c1][b1][c2] = []
        for (let b2 = 0; b2 <= 1; b2++) {
          const bonus1 = b1 * t4Lf
          const bonus2 = b2 * t4Lf
          const price1 = pricesPerLf[c1]
          const price2 = pricesPerLf[c2]
          const lfFirst123: [number, number, number] = [0, 0, 0]
          const lfFirst4: [number, number, number] = [0, 0, 0]
          const lfSecond123: [number, number, number] = [0, 0, 0]
          const lfSecond4: [number, number, number] = [0, 0, 0]
          for (const d1 of lfDist) {
            for (const d2 of lfDist) {
              const totalLf1 = d1.lf123 + d1.lf4 + bonus1
              const totalLf2 = d2.lf123 + d2.lf4 + bonus2
              const v1 = totalLf1 * price1
              const v2 = totalLf2 * price2
              const prob = d1.prob * d2.prob
              // Harvest always keeps the higher-value plot as "first pick"
              if (v1 >= v2) {
                lfFirst123[c1] += d1.lf123 * prob
                lfFirst4[c1] += (d1.lf4 + bonus1) * prob
                lfSecond123[c2] += d2.lf123 * prob
                lfSecond4[c2] += (d2.lf4 + bonus2) * prob
              } else {
                lfFirst123[c2] += d2.lf123 * prob
                lfFirst4[c2] += (d2.lf4 + bonus2) * prob
                lfSecond123[c1] += d1.lf123 * prob
                lfSecond4[c1] += (d1.lf4 + bonus1) * prob
              }
            }
          }
          lookup[c1][b1][c2][b2] = { lfFirst123, lfFirst4, lfSecond123, lfSecond4 }
        }
      }
    }
  }
  return lookup
}

// ============ Reduction configs ============

export function enumerateConfigs(reductions: readonly number[]): HarvestReductionConfig[] {
  const configs: HarvestReductionConfig[] = []
  for (const ry of reductions) {
    for (const rb of reductions) {
      for (const rr of reductions) {
        configs.push({ ry, rb, rr })
      }
    }
  }
  return configs
}

// ============ Sequence enumeration + Cornucopia DP ============

export function generateColorSequences(numPlots: number): number[][] {
  const sequences: number[][] = []
  const total = Math.pow(3, numPlots)
  for (let i = 0; i < total; i++) {
    const seq: number[] = []
    let n = i
    for (let j = 0; j < numPlots; j++) {
      seq.push(n % 3)
      n = Math.floor(n / 3)
    }
    sequences.push(seq)
  }
  return sequences
}

const SEQUENCE_CACHE: Record<number, number[][]> = {}
export function getSequences(numPairs: number): number[][] {
  if (!SEQUENCE_CACHE[numPairs]) SEQUENCE_CACHE[numPairs] = generateColorSequences(numPairs * 2)
  return SEQUENCE_CACHE[numPairs]
}

export function sequenceProbability(sequence: number[], colorProbs: [number, number, number]): number {
  let prob = 1
  for (const color of sequence) prob *= colorProbs[color]
  return prob
}

export function calculateSequenceEV(opts: {
  sequence: number[]
  pairLookup: PairLookup
  notWiltChance: number
  useCornucopia: boolean
}): { lf123: [number, number, number]; lf4: [number, number, number] } {
  const { sequence, pairLookup, notWiltChance, useCornucopia } = opts
  const numPairs = sequence.length / 2
  const firstOfColor = [-1, -1, -1]
  if (useCornucopia) {
    for (let i = 0; i < sequence.length; i++) {
      const color = sequence[i]
      if (firstOfColor[color] === -1) firstOfColor[color] = i
    }
  }
  const totalLf123: [number, number, number] = [0, 0, 0]
  const totalLf4: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < numPairs; i++) {
    const idx1 = i * 2
    const idx2 = i * 2 + 1
    const color1 = sequence[idx1]
    const color2 = sequence[idx2]
    const bonus1 = useCornucopia && firstOfColor[color1] === idx1 ? 1 : 0
    const bonus2 = useCornucopia && firstOfColor[color2] === idx2 ? 1 : 0
    const { lfFirst123, lfFirst4, lfSecond123, lfSecond4 } = pairLookup[color1][bonus1][color2][bonus2]
    for (let c = 0; c < 3; c++) {
      totalLf123[c] += lfFirst123[c] + lfSecond123[c] * notWiltChance
      totalLf4[c] += lfFirst4[c] + lfSecond4[c] * notWiltChance
    }
  }
  return { lf123: totalLf123, lf4: totalLf4 }
}

export function computeExpectedEV_NoCornucopia(
  numPairs: number,
  colorProbs: [number, number, number],
  pairLookup: PairLookup,
  notWiltChance: number,
): { lf123: [number, number, number]; lf4: [number, number, number] } {
  const pairEV_lf123: [number, number, number] = [0, 0, 0]
  const pairEV_lf4: [number, number, number] = [0, 0, 0]
  for (let c1 = 0; c1 < 3; c1++) {
    for (let c2 = 0; c2 < 3; c2++) {
      const prob = colorProbs[c1] * colorProbs[c2]
      const { lfFirst123, lfFirst4, lfSecond123, lfSecond4 } = pairLookup[c1][0][c2][0]
      for (let c = 0; c < 3; c++) {
        pairEV_lf123[c] += prob * (lfFirst123[c] + lfSecond123[c] * notWiltChance)
        pairEV_lf4[c] += prob * (lfFirst4[c] + lfSecond4[c] * notWiltChance)
      }
    }
  }
  return {
    lf123: pairEV_lf123.map((v) => v * numPairs) as [number, number, number],
    lf4: pairEV_lf4.map((v) => v * numPairs) as [number, number, number],
  }
}

export function computeExpectedEV_Cornucopia(
  numPairs: number,
  colorProbs: [number, number, number],
  pairLookup: PairLookup,
  notWiltChance: number,
): { lf123: [number, number, number]; lf4: [number, number, number] } {
  type DpState = { prob: number; lf123: [number, number, number]; lf4: [number, number, number] }
  const makeState = (): DpState => ({ prob: 0, lf123: [0, 0, 0], lf4: [0, 0, 0] })
  let dp: DpState[] = Array.from({ length: 8 }, makeState)
  dp[0].prob = 1
  for (let pair = 0; pair < numPairs; pair++) {
    const newDp: DpState[] = Array.from({ length: 8 }, makeState)
    for (let mask = 0; mask < 8; mask++) {
      if (dp[mask].prob === 0) continue
      for (let c1 = 0; c1 < 3; c1++) {
        for (let c2 = 0; c2 < 3; c2++) {
          const b1 = mask & (1 << c1) ? 0 : 1
          const maskAfterC1 = mask | (1 << c1)
          const b2 = maskAfterC1 & (1 << c2) ? 0 : 1
          const newMask = maskAfterC1 | (1 << c2)
          const transitionProb = colorProbs[c1] * colorProbs[c2]
          const lup = pairLookup[c1][b1][c2][b2]
          newDp[newMask].prob += dp[mask].prob * transitionProb
          for (let c = 0; c < 3; c++) {
            const contribution123 = lup.lfFirst123[c] + lup.lfSecond123[c] * notWiltChance
            const contribution4 = lup.lfFirst4[c] + lup.lfSecond4[c] * notWiltChance
            newDp[newMask].lf123[c] += transitionProb * (dp[mask].lf123[c] + contribution123 * dp[mask].prob)
            newDp[newMask].lf4[c] += transitionProb * (dp[mask].lf4[c] + contribution4 * dp[mask].prob)
          }
        }
      }
    }
    dp = newDp
  }
  const result: { lf123: [number, number, number]; lf4: [number, number, number] } = {
    lf123: [0, 0, 0],
    lf4: [0, 0, 0],
  }
  for (let mask = 0; mask < 8; mask++) {
    for (let c = 0; c < 3; c++) {
      result.lf123[c] += dp[mask].lf123[c]
      result.lf4[c] += dp[mask].lf4[c]
    }
  }
  return result
}

export function runEnumerationOptimized(opts: {
  colorProbs: [number, number, number]
  pairLookup: PairLookup
  pairDist: Record<number, number>
  notWiltChance: number
  useCornucopia: boolean
}): { lf123: [number, number, number]; lf4: [number, number, number] } {
  const { colorProbs, pairLookup, pairDist, notWiltChance, useCornucopia } = opts
  const entries = Object.entries(pairDist)
    .map(([k, v]): [number, number] => [Number(k), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && k > 0 && Number.isFinite(v) && v > 0)
  if (entries.length === 0) return { lf123: [0, 0, 0], lf4: [0, 0, 0] }
  const sum = entries.reduce((acc, [, v]) => acc + v, 0)
  const totalLf123: [number, number, number] = [0, 0, 0]
  const totalLf4: [number, number, number] = [0, 0, 0]
  for (const [numPairs, weight] of entries) {
    const pairProb = weight / sum
    const { lf123, lf4 } = useCornucopia
      ? computeExpectedEV_Cornucopia(numPairs, colorProbs, pairLookup, notWiltChance)
      : computeExpectedEV_NoCornucopia(numPairs, colorProbs, pairLookup, notWiltChance)
    for (let c = 0; c < 3; c++) {
      totalLf123[c] += lf123[c] * pairProb
      totalLf4[c] += lf4[c] * pairProb
    }
  }
  return { lf123: totalLf123, lf4: totalLf4 }
}

// ============ Main entry point ============

export function solveHarvest(opts: HarvestSolveOptions): HarvestSolveResult {
  const {
    prices,
    pairDist,
    useAwakener,
    useDoubling,
    useCornucopia,
    mapQuant,
    packsize,
    bonusLifeforce,
    duplicateMonster,
    notWilt,
    duplicateLifeforce,
    params,
    seedDist,
    phreciaMode = false,
  } = opts

  const entries = Object.entries(pairDist)
    .map(([k, v]): [number, number] => [Number(k), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && k > 0 && Number.isFinite(v) && v > 0)
  if (entries.length === 0) return { meta: {}, top: [] }

  const sum = entries.reduce((acc, [, v]) => acc + v, 0)
  let avgPairs = 0
  for (const [pairs, weight] of entries) avgPairs += pairs * (weight / sum)

  const notWiltChance = Math.min(1, notWilt + (useAwakener ? AWAKENER_NOT_WILT : 0))
  const qtyMult = 1 + bonusLifeforce + mapQuant * MAP_QUANT_CONTRIBUTION
  const duplicateMonsterChance = duplicateMonster + (useAwakener ? AWAKENER_DUPLICATE_MONSTER : 0)
  const monsterMult = 1 + duplicateMonsterChance + packsize
  const lifeforceDupMult = useDoubling ? DOUBLING_LIFEFORCE_MULT : 1 + Math.min(1, duplicateLifeforce)
  const lfMult123 = qtyMult * monsterMult * lifeforceDupMult
  const lfMult4 = qtyMult * lifeforceDupMult

  const t4Lf = params.lfPerTier[3]
  const pricesPerLf: [number, number, number] = [prices.y, prices.b, prices.r]

  const lfDist = buildLfDistribution(params.lfPerTier, seedDist)
  const pairLookup = buildPairLookup(lfDist, pricesPerLf, t4Lf)

  const reductions = phreciaMode ? PHRECIA_REDUCTIONS : REDUCTIONS
  const configs = enumerateConfigs(reductions)
  const baseWeights = { y: 100, b: 100, r: 100 }
  const getMultiplier = (reduction: number) => MULTIPLIER[reduction] ?? 1 - reduction / 100

  const results: HarvestResultRow[] = configs.map((cfg) => {
    const weights = {
      y: baseWeights.y * getMultiplier(cfg.ry),
      b: baseWeights.b * getMultiplier(cfg.rb),
      r: baseWeights.r * getMultiplier(cfg.rr),
    }
    const totalWeight = weights.y + weights.b + weights.r
    const colorProbs: [number, number, number] = [
      weights.y / totalWeight,
      weights.b / totalWeight,
      weights.r / totalWeight,
    ]
    const { lf123, lf4 } = runEnumerationOptimized({
      colorProbs,
      pairLookup,
      pairDist,
      notWiltChance,
      useCornucopia,
    })
    const expectedLf: [number, number, number] = [
      lf123[0] * lfMult123 + lf4[0] * lfMult4,
      lf123[1] * lfMult123 + lf4[1] * lfMult4,
      lf123[2] * lfMult123 + lf4[2] * lfMult4,
    ]
    const expectedValue = expectedLf[0] * prices.y + expectedLf[1] * prices.b + expectedLf[2] * prices.r
    const pointCostProxy = phreciaMode
      ? cfg.ry + cfg.rb + cfg.rr
      : NODE_COUNT[cfg.ry] + NODE_COUNT[cfg.rb] + NODE_COUNT[cfg.rr]
    return {
      reductions: { yellow: cfg.ry, blue: cfg.rb, red: cfg.rr },
      pointCostProxy,
      expectedLf,
      expectedValue,
      weights,
    }
  })

  results.sort((a, b) => {
    const evDiff = b.expectedValue - a.expectedValue
    if (Math.abs(evDiff) > 1e-9) return evDiff
    const tA = a.reductions.yellow + a.reductions.blue + a.reductions.red
    const tB = b.reductions.yellow + b.reductions.blue + b.reductions.red
    return tA - tB
  })

  const avgPlotsHarvested = avgPairs * (1 + notWiltChance)

  return {
    meta: {
      useAwakener,
      useDoubling,
      useCornucopia,
      notWiltChance,
      qtyMult,
      monsterMult,
      lifeforceDupMult,
      lfMult123,
      lfMult4,
      avgPairs,
      avgPlotsHarvested,
    },
    top: results,
  }
}
