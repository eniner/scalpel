/* Crop Rotation engine — pure math, no DOM access.
 * Ported 1:1 from `ref-crop-rotation-engine.js` (verbatim `CropRotationEngine.solve(...)`
 * behaviour), including the top-down memoized DP over harvest order and the
 * base-lifeforce cache keyed on price ratios (the DP result only depends on
 * relative color prices, not absolute values).
 */

export const YELLOW = 0
export const BLUE = 1
export const RED = 2

export const REDUCTIONS = [0, 10, 20, 25, 35, 45] as const
export const MULTIPLIER: Record<number, number> = { 0: 1.0, 10: 0.9, 20: 0.8, 25: 0.75, 35: 0.65, 45: 0.55 }
export const NODE_COUNT: Record<number, number> = { 0: 0, 10: 1, 20: 2, 25: 1, 35: 2, 45: 3 }
export const PHRECIA_REDUCTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const

export const AWAKENER_NOT_WILT = 0.5
export const AWAKENER_EXTRA_MONSTER = 0.5
export const MAP_QUANT_CONTRIBUTION = 0.5
export const DOUBLING_LIFEFORCE_MULT = 2.0

export const DEFAULT_LIFEFORCE_AT_UPGRADES: Record<number, number> = {
  0: 3,
  1: 11,
  2: 70,
  3: 162,
  4: 275,
  5: 402,
  6: 536,
  7: 674,
  8: 812,
  9: 948,
}
export const DEFAULT_LIFEFORCE_MAX_AT_UPGRADES: Record<number, number> = {
  0: 4,
  1: 15,
  2: 85,
  3: 190,
  4: 310,
  5: 445,
  6: 585,
  7: 730,
  8: 870,
  9: 1010,
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function intToTrinary(n: number, length: number): string {
  let s = ''
  let rem = n
  while (rem > 0) {
    s = String(rem % 3) + s
    rem = Math.floor(rem / 3)
  }
  return s.padStart(length, '0')
}

function powInt(base: number, exp: number): number {
  let x = 1
  for (let i = 0; i < exp; i++) x *= base
  return x
}

type Plot = { c: number; u: number; alive: boolean }
type Field = [Plot, Plot]

function buildStateFromSeed(seed: number, plotSize: number): Field[] {
  const tri = intToTrinary(seed, plotSize)
  const fields: Field[] = []
  for (let i = 0; i < tri.length; i += 2) {
    fields.push([
      { c: Number(tri[i]), u: 0, alive: true },
      { c: Number(tri[i + 1]), u: 0, alive: true },
    ])
  }
  return fields
}

function cloneFields(fields: Field[]): Field[] {
  return fields.map((f) => f.map((p) => ({ c: p.c, u: p.u, alive: p.alive })) as Field)
}

function getChoices(fields: Field[]): [number, number][] {
  const choices: [number, number][] = []
  for (let fi = 0; fi < fields.length; fi++) {
    for (let pi = 0; pi < 2; pi++) {
      if (fields[fi][pi].alive) choices.push([fi, pi])
    }
  }
  return choices
}

/** Canonical key for DP memoization: plots are unordered within/between fields
 * (only (color, upgradeCount) pairs matter for the mean-field EV), so sort to
 * collapse symmetric states into one memo entry. */
function canonicalKey(fields: Field[]): string {
  const fieldSigs: string[] = []
  for (const f of fields) {
    const plotSigs: string[] = []
    for (const p of f) {
      if (!p.alive) continue
      plotSigs.push(`${p.c}_${p.u}`)
    }
    if (plotSigs.length === 0) continue
    plotSigs.sort()
    fieldSigs.push(plotSigs.join('|'))
  }
  fieldSigs.sort()
  return fieldSigs.join(',')
}

/** "Mean field" harvest: harvesting one plot gives its own LF (at its current
 * upgrade count) and bumps every OTHER still-alive, different-colored plot's
 * upgrade count by 1 (capped). The harvested plot dies; its paired plot may
 * then wilt (handled by the caller via killUnchosenPlot + wilt-probability branch). */
function applyHarvestMeanField(
  fields: Field[],
  fieldIdx: number,
  plotIdx: number,
  maxUpgrade: number,
  lifeforceAtUpgrades: Record<number, number>,
  valuesByColor: Record<number, number>,
): { nextAfterHarvest: Field[]; harvestedValue: number; harvestedLf: number; harvestedColor: number } {
  const next = cloneFields(fields)
  const harvested = next[fieldIdx][plotIdx]
  const uClamped = Math.min(harvested.u, maxUpgrade)
  const harvestedLf = lifeforceAtUpgrades[uClamped]
  const harvestedValue = harvestedLf * valuesByColor[harvested.c]
  const harvestedColor = harvested.c
  harvested.alive = false
  for (const f of next) {
    for (const p of f) {
      if (!p.alive) continue
      if (p.c !== harvestedColor) p.u = Math.min(p.u + 1, maxUpgrade)
    }
  }
  return { nextAfterHarvest: next, harvestedValue, harvestedLf, harvestedColor }
}

function killUnchosenPlot(fieldsAfterHarvest: Field[], fieldIdx: number, plotIdx: number): Field[] {
  const next = cloneFields(fieldsAfterHarvest)
  const otherIdx = 1 - plotIdx
  if (next[fieldIdx][otherIdx].alive) next[fieldIdx][otherIdx].alive = false
  return next
}

type DpResult = { value: number; lf: [number, number, number] }

/** Top-down DP over harvest ORDER: at each state, try harvesting every still-alive
 * plot, take the wilt-probability-weighted best of (harvest-then-continue) vs.
 * (harvest-then-pair-wilts), and keep whichever *first* choice maximizes total EV
 * — this is what makes it an "optimizer" (which plot to harvest next) rather than
 * a fixed-order calculator. */
function makeDpSolver(opts: {
  wiltProb: number
  lifeforceAtUpgrades: Record<number, number>
  lifeforceMaxAtUpgrades: Record<number, number>
  valuesByColor: Record<number, number>
}) {
  const { wiltProb, lifeforceAtUpgrades, lifeforceMaxAtUpgrades, valuesByColor } = opts
  const memo = new Map<string, DpResult>()
  const maxUpgrade = Math.max(...Object.keys(lifeforceAtUpgrades).map(Number))

  function dp(fields: Field[]): DpResult {
    const key = canonicalKey(fields)
    const cached = memo.get(key)
    if (cached) return cached

    const choices = getChoices(fields)
    if (choices.length === 0) {
      const result: DpResult = { value: 0, lf: [0, 0, 0] }
      memo.set(key, result)
      return result
    }

    // Mono-color short circuit: once only one color remains alive, harvest order
    // no longer matters, so just sum each field's plot(s) directly.
    const aliveColors = new Set<number>()
    for (const f of fields) for (const p of f) if (p.alive) aliveColors.add(p.c)

    if (aliveColors.size === 1) {
      const color = [...aliveColors][0]
      let totalLf = 0
      for (const f of fields) {
        const alivePlots = f.filter((p) => p.alive)
        if (alivePlots.length === 0) continue
        const u = Math.min(alivePlots[0].u, maxUpgrade)
        const eLF = lifeforceAtUpgrades[u]
        const eMax = lifeforceMaxAtUpgrades[u]
        if (alivePlots.length === 1) totalLf += eLF
        else totalLf += eMax * wiltProb + 2 * eLF * (1 - wiltProb)
      }
      const lf: [number, number, number] = [0, 0, 0]
      lf[color] = totalLf
      const result: DpResult = { value: totalLf * valuesByColor[color], lf }
      memo.set(key, result)
      return result
    }

    let best: DpResult = { value: 0, lf: [0, 0, 0] }
    for (const [fi, pi] of choices) {
      const { nextAfterHarvest, harvestedValue, harvestedLf, harvestedColor } = applyHarvestMeanField(
        fields,
        fi,
        pi,
        maxUpgrade,
        lifeforceAtUpgrades,
        valuesByColor,
      )
      const rUnwilt = dp(nextAfterHarvest)
      const wilted = killUnchosenPlot(nextAfterHarvest, fi, pi)
      const rWilt = dp(wilted)
      const expectedValue = harvestedValue + (1 - wiltProb) * rUnwilt.value + wiltProb * rWilt.value
      const expectedLf: [number, number, number] = [0, 0, 0]
      for (let c = 0; c < 3; c++) {
        expectedLf[c] =
          (c === harvestedColor ? harvestedLf : 0) + (1 - wiltProb) * rUnwilt.lf[c] + wiltProb * rWilt.lf[c]
      }
      if (expectedValue > best.value) best = { value: expectedValue, lf: expectedLf }
    }
    memo.set(key, best)
    return best
  }
  return { dp }
}

function colorProbabilitiesFromWeights(yWeight: number, bWeight: number, rWeight: number): Record<number, number> {
  const total = yWeight + bWeight + rWeight
  return { [YELLOW]: yWeight / total, [BLUE]: bWeight / total, [RED]: rWeight / total }
}

function pmfOfTrinary(tri: string, colorProbs: Record<number, number>): number {
  let p = 1
  for (const ch of tri) p *= colorProbs[Number(ch)]
  return p
}

function enumerateReductionConfigs(phreciaMode: boolean) {
  const reductions = phreciaMode ? PHRECIA_REDUCTIONS : REDUCTIONS
  const maxReduction = reductions[reductions.length - 1]
  const configs: { ry: number; rb: number; rr: number }[] = []
  for (const ry of reductions) {
    for (const rb of reductions) {
      for (const rr of reductions) {
        // Only enumerate configs where at least one color is maxed out — this
        // trims the search space (partial reductions on all 3 colors at once
        // are never optimal since you'd rather max one color's block first).
        if (ry !== maxReduction && rb !== maxReduction && rr !== maxReduction) continue
        configs.push({ ry, rb, rr })
      }
    }
  }
  return configs
}

function precomputeSeedValues(plotSizes: number[], dp: (fields: Field[]) => DpResult) {
  const byPlotSize = new Map<number, { seedResults: DpResult[]; trinaries: string[] }>()
  for (const plotSize of plotSizes) {
    const nSeeds = powInt(3, plotSize)
    const seedResults: DpResult[] = new Array(nSeeds)
    const trinaries: string[] = new Array(nSeeds)
    for (let seed = 0; seed < nSeeds; seed++) {
      trinaries[seed] = intToTrinary(seed, plotSize)
      seedResults[seed] = dp(buildStateFromSeed(seed, plotSize))
    }
    byPlotSize.set(plotSize, { seedResults, trinaries })
  }
  return byPlotSize
}

// ============ Base lifeforce cache ============

export type CropRotationBaseConfig = {
  reductions: { yellow: number; blue: number; red: number }
  pointCostProxy: number
  baseLf: [number, number, number]
  effectiveWeights: { y: number; b: number; r: number }
}

let dpCache = new Map<string, CropRotationBaseConfig[]>()

function getPriceRatioKey(prices: { y: number; b: number; r: number }): string {
  const vals = [prices.y, prices.b, prices.r]
  const max = Math.max(...vals)
  if (max === 0) return '1:1:1'
  return vals.map((v) => (v / max).toFixed(3)).join(':')
}

function getCacheKey(
  pairDist: Record<number, number>,
  useAwakener: boolean,
  notWiltChance: number,
  prices: { y: number; b: number; r: number },
  phreciaMode: boolean,
  lifeforceSig: string,
): string {
  return `${JSON.stringify(pairDist)}|${useAwakener}|${Math.round(notWiltChance * 1000)}|${getPriceRatioKey(prices)}|${phreciaMode ? 'p' : 'a'}|${lifeforceSig}`
}

function computeBaseLifeforce(
  useAwakener: boolean,
  notWiltChance: number,
  pairDist: Record<number, number>,
  prices: { y: number; b: number; r: number },
  phreciaMode: boolean,
  lifeforceAtUpgrades: Record<number, number>,
  lifeforceMaxAtUpgrades: Record<number, number>,
): CropRotationBaseConfig[] {
  const entries = Object.entries(pairDist)
    .map(([k, v]): [number, number] => [Number(k), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && k > 0 && Number.isFinite(v) && v > 0)
  if (entries.length === 0) return []

  const sum = entries.reduce((acc, [, v]) => acc + v, 0)
  const plotSizeDist: Record<number, number> = {}
  for (const [pairs, v] of entries) plotSizeDist[pairs * 2] = v / sum

  const wiltProb = clamp01(1 - notWiltChance)
  const valuesByColor = { [YELLOW]: prices.y, [BLUE]: prices.b, [RED]: prices.r }
  const { dp } = makeDpSolver({ wiltProb, lifeforceAtUpgrades, lifeforceMaxAtUpgrades, valuesByColor })

  const plotSizes = Object.keys(plotSizeDist)
    .map(Number)
    .sort((a, b) => a - b)
  const precomputed = precomputeSeedValues(plotSizes, dp)

  const configs = enumerateReductionConfigs(phreciaMode)
  const baseWeights = { y: 100, b: 100, r: 100 }
  const getMultiplier = (reduction: number) => MULTIPLIER[reduction] ?? 1 - reduction / 100

  return configs.map((cfg) => {
    const yW = baseWeights.y * getMultiplier(cfg.ry)
    const bW = baseWeights.b * getMultiplier(cfg.rb)
    const rW = baseWeights.r * getMultiplier(cfg.rr)
    const probs = colorProbabilitiesFromWeights(yW, bW, rW)

    const baseLf: [number, number, number] = [0, 0, 0]
    for (const [plotSizeStr, pPlotSize] of Object.entries(plotSizeDist)) {
      const plotSize = Number(plotSizeStr)
      const precomp = precomputed.get(plotSize)
      if (!precomp) continue
      const { seedResults, trinaries } = precomp
      for (let seed = 0; seed < seedResults.length; seed++) {
        const pmf = pPlotSize * pmfOfTrinary(trinaries[seed], probs)
        const r = seedResults[seed]
        for (let c = 0; c < 3; c++) baseLf[c] += pmf * r.lf[c]
      }
    }

    const pointCostProxy = phreciaMode
      ? cfg.ry + cfg.rb + cfg.rr
      : NODE_COUNT[cfg.ry] + NODE_COUNT[cfg.rb] + NODE_COUNT[cfg.rr]

    return {
      reductions: { yellow: cfg.ry, blue: cfg.rb, red: cfg.rr },
      pointCostProxy,
      baseLf,
      effectiveWeights: { y: yW, b: bW, r: rW },
    }
  })
}

function getBaseLifeforce(
  pairDist: Record<number, number>,
  useAwakener: boolean,
  notWiltChance: number,
  prices: { y: number; b: number; r: number },
  phreciaMode: boolean,
  lifeforceAtUpgrades: Record<number, number>,
  lifeforceMaxAtUpgrades: Record<number, number>,
): CropRotationBaseConfig[] {
  const lifeforceSig = Object.values(lifeforceAtUpgrades).join('_')
  const key = getCacheKey(pairDist, useAwakener, notWiltChance, prices, phreciaMode, lifeforceSig)
  const hit = dpCache.get(key)
  if (hit) return hit
  const result = computeBaseLifeforce(
    useAwakener,
    notWiltChance,
    pairDist,
    prices,
    phreciaMode,
    lifeforceAtUpgrades,
    lifeforceMaxAtUpgrades,
  )
  dpCache.set(key, result)
  return result
}

// ============ Main entry point ============

export type CropRotationSolveOptions = {
  prices: { y: number; b: number; r: number }
  pairDist: Record<number, number>
  useAwakener: boolean
  useDoubling: boolean
  mapQuant: number
  packsize: number
  bonusLifeforce: number
  duplicateMonster: number
  notWilt: number
  duplicateLifeforce: number
  phreciaMode?: boolean
  lifeforceAtUpgrades?: Record<number, number>
  lifeforceMaxAtUpgrades?: Record<number, number>
}

export type CropRotationResultRow = CropRotationBaseConfig & {
  expectedLf: [number, number, number]
  expectedValue: number
}

export type CropRotationMeta = {
  useAwakener: boolean
  useDoubling: boolean
  notWiltChance: number
  wiltProb: number
  qtyMult: number
  monsterMult: number
  lifeforceDupMult: number
  packsizeMult: number
  lfMult: number
}

export type CropRotationSolveResult = {
  meta: CropRotationMeta
  top: CropRotationResultRow[]
}

export function solveCropRotation(opts: CropRotationSolveOptions): CropRotationSolveResult {
  const {
    prices,
    pairDist,
    useAwakener,
    useDoubling,
    mapQuant,
    packsize,
    bonusLifeforce,
    duplicateMonster,
    notWilt,
    duplicateLifeforce,
    phreciaMode = false,
    lifeforceAtUpgrades = DEFAULT_LIFEFORCE_AT_UPGRADES,
    lifeforceMaxAtUpgrades = DEFAULT_LIFEFORCE_MAX_AT_UPGRADES,
  } = opts

  const notWiltChance = clamp01(notWilt + (useAwakener ? AWAKENER_NOT_WILT : 0))
  const cached = getBaseLifeforce(
    pairDist,
    useAwakener,
    notWiltChance,
    prices,
    phreciaMode,
    lifeforceAtUpgrades,
    lifeforceMaxAtUpgrades,
  )
  if (!cached || cached.length === 0) throw new Error('Failed to compute configurations')

  const wiltProb = clamp01(1 - notWiltChance)
  const qtyMult = 1 + bonusLifeforce + mapQuant * MAP_QUANT_CONTRIBUTION
  const extraMonsterChance = duplicateMonster + (useAwakener ? AWAKENER_EXTRA_MONSTER : 0)
  const monsterMult = 1 + extraMonsterChance
  const lifeforceDupMult = useDoubling ? DOUBLING_LIFEFORCE_MULT : 1 + Math.min(1, duplicateLifeforce)
  const packsizeMult = 1 + packsize
  const lfMult = qtyMult * monsterMult * lifeforceDupMult * packsizeMult

  const results: CropRotationResultRow[] = cached.map((cfg) => {
    const finalLf = cfg.baseLf.map((lf) => lf * lfMult) as [number, number, number]
    const expectedValue = finalLf[0] * prices.y + finalLf[1] * prices.b + finalLf[2] * prices.r
    return { ...cfg, expectedLf: finalLf, expectedValue }
  })

  results.sort((a, b) => {
    const evDiff = b.expectedValue - a.expectedValue
    if (Math.abs(evDiff) > 1e-9) return evDiff
    const tA = a.reductions.yellow + a.reductions.blue + a.reductions.red
    const tB = b.reductions.yellow + b.reductions.blue + b.reductions.red
    return tA - tB
  })

  return {
    meta: { useAwakener, useDoubling, notWiltChance, wiltProb, qtyMult, monsterMult, lifeforceDupMult, packsizeMult, lfMult },
    top: results,
  }
}

export function clearCache(): void {
  dpCache = new Map()
}

// ============ Monte-Carlo lifeforce simulator (for optional "Settings" recompute) ============

export function simulateLifeforceAtUpgrades(opts: {
  seedsPerPlot: number
  upgradeProbs: [number, number, number]
  lfPerTier: [number, number, number, number]
  iterations?: number
}): { expected: Record<number, number>; expectedMax: Record<number, number> } {
  const { seedsPerPlot, upgradeProbs, lfPerTier, iterations = 50000 } = opts
  const maxUpgrade = 10
  const result: Record<number, number> = {}
  const maxResult: Record<number, number> = {}
  for (let i = 0; i < maxUpgrade; i++) {
    result[i] = 0
    maxResult[i] = 0
  }

  const samples: Record<number, number[]> = {}
  for (let i = 0; i < maxUpgrade; i++) samples[i] = []

  for (let iter = 0; iter < iterations; iter++) {
    const seeds = [seedsPerPlot, 0, 0, 0]
    for (let upgrade = 0; upgrade < maxUpgrade; upgrade++) {
      let value = 0
      for (let tier = 0; tier < 4; tier++) value += seeds[tier] * lfPerTier[tier]
      result[upgrade] += value / iterations
      samples[upgrade].push(value)
      for (let tier = 2; tier >= 0; tier--) {
        let upgraded = 0
        for (let s = 0; s < seeds[tier]; s++) if (Math.random() < upgradeProbs[tier]) upgraded++
        seeds[tier] -= upgraded
        seeds[tier + 1] += upgraded
      }
    }
  }
  for (let upgrade = 0; upgrade < maxUpgrade; upgrade++) {
    const s = samples[upgrade]
    let sumMax = 0
    const pairCount = Math.floor(s.length / 2)
    for (let i = 0; i < pairCount; i++) sumMax += Math.max(s[i * 2], s[i * 2 + 1])
    maxResult[upgrade] = pairCount > 0 ? sumMax / pairCount : 0
  }
  for (let i = 0; i < maxUpgrade; i++) result[i] = Math.round(result[i])
  return { expected: result, expectedMax: maxResult }
}
