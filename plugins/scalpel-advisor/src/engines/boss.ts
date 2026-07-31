export type BossDrop = {
  name: string
  rate: number
  currencyId?: string
  tracked?: boolean
  priceKey?: string
  avgPrice?: number
  qty?: number
  noTrade?: boolean
}

export type BossDef = {
  name: string
  icon?: string
  entryItems: Array<{
    id: string
    name: string
    qty?: number
    tracked?: boolean
  }>
  guaranteedDrops: BossDrop[]
  drops: BossDrop[]
  extraDrops?: BossDrop[]
  gemDrops?: {
    baseRate: number
    gems: Array<{ name: string; weight: number }>
  }
  quantityBonus?: number
}

export type PriceLookup = {
  currency: (id: string) => number
  unique: (name: string) => number
}

function priceForDrop(drop: BossDrop, prices: PriceLookup): number {
  if (drop.currencyId) return prices.currency(drop.currencyId)
  if (drop.tracked || drop.priceKey || drop.name) {
    return prices.unique(drop.priceKey || drop.name)
  }
  return drop.avgPrice || 0
}

export function calculateBossEV(
  boss: BossDef,
  prices: PriceLookup,
  quantityBonusOverride?: number,
): { entry: number; ev: number; profit: number } {
  let entry = 0
  for (const item of boss.entryItems) {
    const qty = item.qty || 1
    const price = item.tracked ? prices.unique(item.name) : prices.currency(item.id)
    entry += price * qty
  }

  let ev = 0

  if ((boss.guaranteedDrops?.length ?? 0) > 0) {
    let guaranteedEV = 0
    for (const drop of boss.guaranteedDrops) {
      const rate = (drop.rate || 100) / 100
      guaranteedEV += rate * priceForDrop(drop, prices)
    }
    ev += guaranteedEV
  }

  if ((boss.drops?.length ?? 0) > 0) {
    for (const drop of boss.drops) {
      ev += (drop.rate / 100) * priceForDrop(drop, prices)
    }
  }

  const qtyBonus = quantityBonusOverride ?? boss.quantityBonus ?? 0
  const quantityMultiplier = qtyBonus ? 1 + qtyBonus / 100 : 1
  for (const drop of boss.extraDrops || []) {
    const p = Math.min(1, (drop.rate / 100) * quantityMultiplier)
    ev += p * priceForDrop(drop, prices)
  }

  if (boss.gemDrops) {
    const baseP = boss.gemDrops.baseRate / 100
    let totalWeight = 0
    let gemEV = 0
    for (const gem of boss.gemDrops.gems) totalWeight += gem.weight
    for (const gem of boss.gemDrops.gems) {
      const p = totalWeight > 0 ? gem.weight / totalWeight : 0
      gemEV += p * prices.unique(gem.name)
    }
    ev += baseP * gemEV
  }

  return { entry, ev, profit: ev - entry }
}

/** One stochastic boss run (profit = loot − entry). */
export function simulateBossRun(boss: BossDef, prices: PriceLookup, quantityBonusOverride?: number): number {
  let value = 0

  for (const item of boss.entryItems) {
    const qty = item.qty || 1
    const price = item.tracked ? prices.unique(item.name) : prices.currency(item.id)
    value -= price * qty
  }

  if ((boss.guaranteedDrops?.length ?? 0) > 0) {
    let roll = Math.random() * 100
    for (const drop of boss.guaranteedDrops) {
      const rate = drop.rate || 100
      if (roll < rate) {
        value += priceForDrop(drop, prices)
        break
      }
      roll -= rate
    }
  }

  if ((boss.drops?.length ?? 0) > 0) {
    let roll = Math.random() * 100
    for (const drop of boss.drops) {
      if (roll < drop.rate) {
        value += priceForDrop(drop, prices)
        break
      }
      roll -= drop.rate
    }
  }

  const qtyBonus = quantityBonusOverride ?? boss.quantityBonus ?? 0
  const quantityMultiplier = qtyBonus ? 1 + qtyBonus / 100 : 1
  for (const drop of boss.extraDrops || []) {
    const rate = drop.rate * quantityMultiplier
    if (Math.random() * 100 < rate) value += priceForDrop(drop, prices)
  }

  if (boss.gemDrops) {
    if (Math.random() * 100 < boss.gemDrops.baseRate) {
      let totalWeight = 0
      for (const gem of boss.gemDrops.gems) totalWeight += gem.weight
      let roll = Math.random() * totalWeight
      for (const gem of boss.gemDrops.gems) {
        if (roll < gem.weight) {
          value += prices.unique(gem.name)
          break
        }
        roll -= gem.weight
      }
    }
  }

  return value
}

export function calculateProfitProbability(
  boss: BossDef,
  prices: PriceLookup,
  numRuns: number,
  simulations: number,
): number {
  let profitableCount = 0
  for (let i = 0; i < simulations; i++) {
    let total = 0
    for (let j = 0; j < numRuns; j++) total += simulateBossRun(boss, prices)
    if (total > 0) profitableCount++
  }
  return profitableCount / simulations
}

export type RiskCategory = 'safe' | 'low' | 'medium' | 'high' | 'negative'

export function getRiskCategory(profitProb: number, profit: number): RiskCategory {
  if (profit <= 0) return 'negative'
  if (profitProb >= 0.95) return 'safe'
  if (profitProb >= 0.8) return 'low'
  if (profitProb >= 0.6) return 'medium'
  return 'high'
}

export const RISK_LABELS: Record<RiskCategory, string> = {
  safe: 'SAFE (95%+ CHANCE FOR PROFIT)',
  low: 'LOW RISK (80–95%)',
  medium: 'MEDIUM RISK (60–80%)',
  high: 'HIGH RISK (<60%)',
  negative: 'NEGATIVE EV',
}
