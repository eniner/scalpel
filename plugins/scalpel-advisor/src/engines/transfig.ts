import { floorToChaos, type Floor } from '../shared/ledger'

export type GemColor = 'red' | 'green' | 'blue'

export type TransfigVariant = {
  gemName: string
  floors: Floor | null
  floorsMax: Floor | null
  maxLevel: number
  listings: number
  listingsMax: number
  volume24h: number
  volume24hMax: number
}

export type TransfigBase = {
  baseName: string
  color: GemColor
  baseFloors: Floor | null
  baseFloorsMax: Floor | null
  baseMaxLevel: number
  variants: TransfigVariant[]
}

export type TransfigData = {
  bases: TransfigBase[]
  exceptionalPrices: Record<string, Floor>
}

/** Literal Divine Font outcome weights (PoE game constants, not user-configurable). */
export const DIVINE_FONT_WEIGHTS = { exceptional: 0.025, bestBase: 0.06, color: 0.915 } as const
export const DEFAULT_FONTS_PER_LAB = 2.0
export const DEFAULT_TIME_PER_LAB_SEC = 360

/**
 * E[max of 3 draws without replacement] from a fixed pool, via the
 * order-statistic identity P(max = i-th smallest, 0-indexed) = C(i,2) / C(N,3).
 */
export function orderStatMaxOf3(pricesInput: number[]): number {
  if (pricesInput.length === 0) return 0
  const prices = [...pricesInput].sort((a, b) => a - b)
  const n = prices.length
  if (n < 3) return Math.max(...prices)
  const cN3 = (n * (n - 1) * (n - 2)) / 6
  let ev = 0
  for (let i = 2; i < n; i++) {
    const ci2 = (i * (i - 1)) / 2
    ev += prices[i] * (ci2 / cN3)
  }
  return ev
}

function variantPrice(
  variant: TransfigVariant,
  l20: boolean,
  cpd: number,
  mirrorDiv: number,
  minVolume: number,
): number {
  const volume = l20 ? variant.volume24hMax : variant.volume24h
  // Below the volume threshold, the variant still occupies a draw slot but
  // can't reliably be sold, so it prices at 0.
  if (volume < minVolume) return 0
  const floors = l20 ? variant.floorsMax : variant.floors
  return floorToChaos(floors, cpd, mirrorDiv) ?? 0
}

export function colorEVs(
  bases: TransfigBase[],
  l20: boolean,
  cpd: number,
  mirrorDiv: number,
  minVolume: number,
): Record<GemColor, number> {
  const pools: Record<GemColor, number[]> = { red: [], green: [], blue: [] }
  for (const base of bases) {
    for (const variant of base.variants) {
      pools[base.color].push(variantPrice(variant, l20, cpd, mirrorDiv, minVolume))
    }
  }
  return {
    red: orderStatMaxOf3(pools.red),
    green: orderStatMaxOf3(pools.green),
    blue: orderStatMaxOf3(pools.blue),
  }
}

export function exceptionalEV(exceptionalPrices: Record<string, Floor>, cpd: number, mirrorDiv: number): number {
  const prices = Object.values(exceptionalPrices).map((f) => floorToChaos(f, cpd, mirrorDiv) ?? 0)
  return orderStatMaxOf3(prices)
}

export type BestBaseResult = {
  baseName: string
  variantName: string
  grossPrice: number
  baseCost: number
  netEv: number
}

export function findBestBase(
  bases: TransfigBase[],
  l20: boolean,
  cpd: number,
  mirrorDiv: number,
  minVolume: number,
): BestBaseResult | null {
  let best: BestBaseResult | null = null
  for (const base of bases) {
    const baseCost = floorToChaos(l20 ? base.baseFloorsMax : base.baseFloors, cpd, mirrorDiv) ?? 0
    for (const variant of base.variants) {
      const grossPrice = variantPrice(variant, l20, cpd, mirrorDiv, minVolume)
      const netEv = grossPrice - baseCost
      if (!best || netEv > best.netEv) {
        best = { baseName: base.baseName, variantName: variant.gemName, grossPrice, baseCost, netEv }
      }
    }
  }
  return best
}

export type DivineFontResult = {
  colorEV: Record<GemColor, number>
  bestColor: GemColor
  bestColorEv: number
  exceptionalEv: number
  best: BestBaseResult | null
  fontEv: number
  fontsPerLab: number
  timePerLabSec: number
  evPerLab: number
  evPerHour: number
}

export type ComputeDivineFontOptions = {
  l20: boolean
  cpd: number
  mirrorDiv?: number
  minVolume?: number
  fontsPerLab?: number
  timePerLabSec?: number
}

export function computeDivineFont(data: TransfigData, opts: ComputeDivineFontOptions): DivineFontResult {
  const {
    l20,
    cpd,
    mirrorDiv = 380,
    minVolume = 0,
    fontsPerLab = DEFAULT_FONTS_PER_LAB,
    timePerLabSec = DEFAULT_TIME_PER_LAB_SEC,
  } = opts

  const colorEV = colorEVs(data.bases, l20, cpd, mirrorDiv, minVolume)
  const exceptEv = exceptionalEV(data.exceptionalPrices, cpd, mirrorDiv)
  const best = findBestBase(data.bases, l20, cpd, mirrorDiv, minVolume)

  const colors = Object.keys(colorEV) as GemColor[]
  const bestColor = colors.reduce((a, b) => (colorEV[b] > colorEV[a] ? b : a))
  const bestColorEv = colorEV[bestColor]
  const bestNetEv = best ? Math.max(best.netEv, 0) : 0

  const fontEv =
    DIVINE_FONT_WEIGHTS.exceptional * exceptEv +
    DIVINE_FONT_WEIGHTS.bestBase * bestNetEv +
    DIVINE_FONT_WEIGHTS.color * bestColorEv

  const evPerLab = fontEv * fontsPerLab
  const labsPerHour = timePerLabSec > 0 ? 3600 / timePerLabSec : 0
  const evPerHour = evPerLab * labsPerHour

  return {
    colorEV,
    bestColor,
    bestColorEv,
    exceptionalEv: exceptEv,
    best,
    fontEv,
    fontsPerLab,
    timePerLabSec,
    evPerLab,
    evPerHour,
  }
}
