export type NightmareBoss = {
  id: string
  name: string
  fragments: string[]
  unique: { name: string; rate: number }
  gem: { name: string; rate: number }
  defaultTpm: number
}

/** Average fragment drops vs in-map IIQ (from Perandus Ledger). */
export function avgFragments(iiq: number): number {
  if (iiq <= 0) return 1.5
  if (iiq <= 235) return 1.5 + (iiq / 235) * 0.5
  if (iiq <= 260) return 2.0 + ((iiq - 235) / 25) * 0.5
  if (iiq <= 350) return 2.5 + ((iiq - 260) / 90) * 0.5
  return 3.0
}

export type NightmareBossResult = {
  boss: NightmareBoss
  fragEv: number
  rareEv: number
  totalEv: number
  profitPerMap: number
  profitPerHour: number
  avgFrags: number
  timeSec: number
}

export function computeNightmareBoss(opts: {
  boss: NightmareBoss
  fragmentNames: Record<string, string>
  fragmentPrices: Record<string, number>
  uniquePrice: number
  gemPrice: number
  uniqueRate: number
  gemRate: number
  mapCost: number
  iiq: number
  timeSec: number
}): NightmareBossResult {
  const avgFrags = avgFragments(opts.iiq)
  const fragPrices = opts.boss.fragments.map((id) => opts.fragmentPrices[id] ?? 0)
  const avgFragPrice =
    fragPrices.length > 0 ? fragPrices.reduce((a, b) => a + b, 0) / fragPrices.length : 0
  const fragEv = avgFrags * avgFragPrice
  const rareEv =
    (opts.uniqueRate / 100) * opts.uniquePrice + (opts.gemRate / 100) * opts.gemPrice
  const totalEv = fragEv + rareEv
  const profitPerMap = totalEv - opts.mapCost
  const profitPerHour = opts.timeSec > 0 ? (profitPerMap / opts.timeSec) * 3600 : 0
  return {
    boss: opts.boss,
    fragEv,
    rareEv,
    totalEv,
    profitPerMap,
    profitPerHour,
    avgFrags,
    timeSec: opts.timeSec,
  }
}
