import { describe, expect, it } from 'vitest'
import { computeBetrayal, type BetrayalRow } from './betrayal'
import { avgFragments, computeNightmareBoss } from './nightmare'
import { calculateBossEV, getRiskCategory, type BossDef } from './boss'
import {
  computeBeastFarm,
  getEffectiveSpawns,
  getThhRate,
  getTotalRedBeasts,
  type Beast,
} from './beasts'
import {
  calcShift,
  calcUptier,
  computeEssenceFarm,
  essenceId,
  getEssPerMonster,
  type EssenceGroup,
} from './essences'
import { buildVendorGuide, computeOptimalStrategy, computeScarabPool, type ScarabCategory } from './scarab'
import { computeRows, type GemLevelingData } from './gemLeveling'
import { computeDivineFont, orderStatMaxOf3, type TransfigData } from './transfig'

describe('betrayal', () => {
  it('computes medallion EV contribution', () => {
    const rows: BetrayalRow[] = [
      {
        id: 'medallion',
        name: 'Syndicate Medallion',
        kind: 'currency',
        currencyId: 'syndicate-medallion',
        defaultDrop: 12,
      },
    ]
    const r = computeBetrayal(
      rows,
      { medallion: 500 },
      { medallion: 12 },
      { transportation: 12, fortification: 15, research: 3.5, intervention: 4 },
      { betrayal: true, reinforcements: false, perpetuation: false },
      { betrayal: 1, reinforcements: 0, perpetuation: 0 },
      240,
    )
    expect(r.grossEvPerMap).toBeGreaterThan(0)
    expect(r.netEvPerMap).toBeCloseTo(r.grossEvPerMap - 1, 5)
  })
})

describe('nightmare', () => {
  it('avgFragments scales with IIQ', () => {
    expect(avgFragments(0)).toBe(1.5)
    expect(avgFragments(235)).toBeCloseTo(2.0, 5)
    expect(avgFragments(400)).toBe(3.0)
  })

  it('computes profit per map', () => {
    const r = computeNightmareBoss({
      boss: {
        id: 'ziggurat',
        name: 'Ziggurat',
        fragments: ['a', 'b'],
        unique: { name: 'U', rate: 5 },
        gem: { name: 'G', rate: 5 },
        defaultTpm: 3,
      },
      fragmentNames: { a: 'A', b: 'B' },
      fragmentPrices: { a: 10, b: 90 },
      uniquePrice: 7,
      gemPrice: 3,
      uniqueRate: 5,
      gemRate: 5,
      mapCost: 33,
      iiq: 200,
      timeSec: 180,
    })
    expect(r.totalEv).toBeGreaterThan(r.fragEv)
    expect(r.profitPerMap).toBeCloseTo(r.totalEv - 33, 5)
  })
})

describe('boss', () => {
  it('calculates EV and risk buckets', () => {
    const boss: BossDef = {
      name: 'Test',
      entryItems: [{ id: 'chaos-orb', name: 'Chaos Orb', qty: 10 }],
      guaranteedDrops: [],
      drops: [{ name: 'Expensive Unique', rate: 100 }],
    }
    const prices = {
      currency: () => 1,
      unique: () => 50,
    }
    const { entry, profit } = calculateBossEV(boss, prices)
    expect(entry).toBe(10)
    expect(profit).toBe(40)
    expect(getRiskCategory(0.97, profit)).toBe('safe')
    expect(getRiskCategory(0.5, profit)).toBe('high')
    expect(getRiskCategory(0.9, -1)).toBe('negative')
  })
})

describe('beasts', () => {
  it('getEffectiveSpawns applies yellow->red conversion', () => {
    // BASE_YELLOW=4.5, +2 additional = 6.5 yellow before conversion; 15% converts to red
    const { effectiveRed, effectiveYellow } = getEffectiveSpawns(30, 2, 15)
    expect(effectiveYellow).toBeCloseTo(6.5 * 0.85, 5)
    // BASE_RED=1 + 0.30 + (6.5*0.15)
    expect(effectiveRed).toBeCloseTo(1 + 0.3 + 6.5 * 0.15, 5)
  })

  it('getThhRate is 50/50 split between markup tiers at 100% chance', () => {
    expect(getThhRate(10, 20)).toBeCloseTo(0.5 * (0.1 + 0.2), 5)
    expect(getThhRate(0, 0)).toBe(0)
  })

  it('getTotalRedBeasts stacks herd/pair/thh additively and duplicating multiplicatively', () => {
    const total = getTotalRedBeasts({
      effectiveRed: 1,
      herdQty: 1,
      hasDuplicating: true,
      thhRate: 0.1,
      pairChancePct: 8,
    })
    // (1 + 5) beasts * (1 + 0.08 + 0.1) * 2
    expect(total).toBeCloseTo(6 * 1.18 * 2, 5)
  })

  it('computeBeastFarm discards low-value beasts without renormalizing probability mass', () => {
    const beasts: Beast[] = [
      { name: 'Cheap', classification: 'A', count: 50, priceId: null },
      { name: 'Expensive', classification: 'A', count: 50, priceId: null },
    ]
    const priceFor = (b: Beast) => (b.name === 'Cheap' ? 1 : 100)
    const result = computeBeastFarm({
      beasts,
      classificationBoosts: {},
      priceFor,
      atlas: { additionalRedPct: 0, additionalYellow: 0, yellowToRedPct: 0, pairChancePct: 0 },
      thh: { markup10Pct: 0, markup20Pct: 0 },
      scarabs: { herdQty: 0, herdPrice: 0, duplicatingQty: 0, duplicatingPrice: 0 },
      yellowPrice: 0,
      discardBelow: 5,
      timePerMapSec: 240,
    })
    // Cheap beast's 50% probability mass contributes 0 (discarded), so EV = 0.5*100 = 50, not 100
    expect(result.evPerRedBeast).toBeCloseTo(50, 5)
    const cheapRow = result.distribution.find((r) => r.beast.name === 'Cheap')
    expect(cheapRow?.discarded).toBe(true)
    expect(cheapRow?.contribution).toBe(0)
  })
})

describe('essences', () => {
  it('essenceId is tierless for group-6 corrupted essences', () => {
    expect(essenceId('deafening', 'greed')).toBe('deafening-essence-of-greed')
    expect(essenceId('deafening', 'insanity')).toBe('essence-of-insanity')
  })

  it('getEssPerMonster applies Crystal Lattice bonus (+15% x1, +15% x3)', () => {
    expect(getEssPerMonster(false)).toBe(2.5)
    expect(getEssPerMonster(true)).toBeCloseTo(2.5 + 0.15 + 0.45, 5)
  })

  it('calcShift caps at group 6 and clamps tier to the target group max', () => {
    expect(calcShift([], 5, 2)).toEqual({ groupId: 6, tierIdx: 2 })
    expect(calcUptier(0)).toBe(0)
    expect(calcUptier(3)).toBe(2)
  })

  it('computeEssenceFarm scales EV by total essences and subtracts scarab cost', () => {
    const groups: EssenceGroup[] = [{ id: 1, essences: ['greed'], maxTier: 1, corrupt: false }]
    const weights = { 'deafening|greed': 0, 'shrieking|greed': 100 }
    const prices: Record<string, number> = { 'shrieking-essence-of-greed': 2 }
    const result = computeEssenceFarm({
      groups,
      tiers: ['deafening', 'shrieking'],
      weights,
      priceFor: (id) => prices[id] ?? null,
      valuation: 'all',
      rareMonstersPerMap: 10,
      crystalLattice: false,
      amplifiedEnergies: false,
      prolificEssence: false,
      crystalResonance: false,
      ascentQty: 0,
      ascentPrice: 0,
      essenceQty: 0,
      essencePrice: 0,
      calcificationQty: 0,
      calcificationPrice: 0,
      adversariesQty: 0,
      adversariesPrice: 0,
      stabilityQty: 0,
      stabilityPrice: 0,
      vaalMode: 'none',
      vaalOrbPrice: 0,
      timePerMapSec: 240,
    })
    // essencedMonsters = 0.08 (base only), essPerMonster = 2.5 -> totalEssences = 0.2
    expect(result.essencedMonsters).toBeCloseTo(0.08, 5)
    expect(result.totalEssences).toBeCloseTo(0.2, 5)
    // Only one essence with weight > 0 (shrieking|greed), all-tiers valuation = market price = 2
    expect(result.totalEV).toBeCloseTo(2, 5)
    expect(result.evPerMap).toBeCloseTo(0.2 * 2, 5)
    expect(result.netProfitPerMap).toBeCloseTo(result.evPerMap, 5)
  })
})

describe('scarab', () => {
  const categories: ScarabCategory[] = [
    {
      id: 'a',
      name: 'A',
      atlasModifier: 'blockable',
      investmentBoost: false,
      scarabs: [{ id: 'a1', name: 'A1', weight: 100, signature: 'aa', untradeable: false }],
    },
    {
      id: 'b',
      name: 'B',
      atlasModifier: 'boostable',
      investmentBoost: true,
      scarabs: [{ id: 'b1', name: 'B1', weight: 100, signature: 'bb', untradeable: false }],
    },
    {
      id: 'c',
      name: 'C',
      atlasModifier: 'none',
      investmentBoost: false,
      scarabs: [{ id: 'c1', name: 'C1', weight: 100, signature: 'cc', untradeable: false }],
    },
  ]
  const prices: Record<string, number> = { a1: 1, b1: 10, c1: 5 }
  const priceFor = (s: { id: string }) => prices[s.id] ?? null

  it('computeScarabPool blends category weights into a single weighted-average EV', () => {
    const pool = computeScarabPool({
      categories,
      priceFor,
      remarkableRelics: false,
      blocked: new Set(),
      boosted: new Set(),
      invested: new Set(),
    })
    // Equal weights -> pool EV is the simple average of category prices
    expect(pool.poolEV).toBeCloseTo((1 + 10 + 5) / 3, 5)
    expect(pool.baselineEV).toBeCloseTo((1 + 10 + 5) / 3, 5)
  })

  it('computeOptimalStrategy blocks the below-pool-EV category and boosts/invests the above-pool one', () => {
    const optimal = computeOptimalStrategy({ categories, priceFor, remarkableRelics: false })
    expect(optimal.blocks).toContain('a')
    expect(optimal.boosts).toContain('b')
    expect(optimal.investments).toContain('b')
    // a blocked -> pool(b,c) = 7.5; b (ev 10) boosted 2x -> pool = 8.33; b invested 1.5x more -> pool = 8.75
    expect(optimal.ev).toBeCloseTo(8.75, 5)
  })

  it('buildVendorGuide flags scarabs priced below rawBaselineEV/3 and builds a bounded search string', () => {
    const guide = buildVendorGuide({ categories, priceFor })
    // rawBaselineEV = avg(1, 10, 5) = 16/3, threshold ~= 1.778 -> only a1 (price 1) qualifies
    expect(guide.vendorThreshold).toBeCloseTo(16 / 3 / 3, 5)
    expect(guide.rows.map((r) => r.scarab.id)).toEqual(['a1'])
    expect(guide.searchString).toBe('"aa"')
  })
})

describe('gemLeveling', () => {
  const DATA: GemLevelingData = {
    league: 'test',
    normalXp: 340000000,
    exceptionalXp: 1660000000,
    xpRatio: 4.882352941176471,
    gcpFloors: { chaos: 3 },
    gems: [
      {
        name: 'Normal Gem',
        type: 'skill',
        color: null,
        buyLevel: 1,
        sellLevel: 20,
        xpMultiplier: 1,
        hasBuyCost: true,
        buyFloors: { chaos: 5 },
        buyListings: 100,
        sellLowFloors: { chaos: 40 },
        sellLowListings: 15,
        sellHighFloors: { chaos: 100 },
        sellHighListings: 16,
      },
      {
        name: 'Exceptional Gem',
        type: 'exceptional',
        color: null,
        buyLevel: 1,
        sellLevel: 3,
        xpMultiplier: 4.882352941176471,
        hasBuyCost: false,
        buyFloors: null,
        buyListings: 0,
        sellLowFloors: { chaos: 340 },
        sellLowListings: 13,
        sellHighFloors: { chaos: 90 },
        sellHighListings: 2,
      },
    ],
    volume: { 'Normal Gem': { low: 36, high: 56 }, 'Exceptional Gem': { low: 5, high: 2 } },
  }

  it('computes profit and normalizes exceptional gems by xpMultiplier', () => {
    const rows = computeRows(DATA, { gcpPrice: 3, gcpsNeeded: 20, cpd: 180, minListings: 3, minVolume: 10 })
    const normal = rows.find((r) => r.gem.name === 'Normal Gem')!
    const exceptional = rows.find((r) => r.gem.name === 'Exceptional Gem')!

    expect(normal.profit0q).toBe(35) // 40 - 5
    expect(normal.profit20q).toBe(100 - 5 - 20 * 3)
    expect(normal.normProfit0q).toBe(35)

    // Free (vendor) exceptional gem: no buy cost, profit normalized by ~4.88x XP.
    expect(exceptional.buy).toBe(0)
    expect(exceptional.profit0q).toBe(340)
    expect(exceptional.normProfit0q).toBeCloseTo(340 / 4.882352941176471, 5)
    expect(exceptional.recommend).toBe('0q')

    // Exceptional gem's high-listings volume is below threshold.
    expect(exceptional.belowThreshold).toBe(true)
    expect(normal.belowThreshold).toBe(false)
  })

  it('recommends skip when both paths are unprofitable', () => {
    const data: GemLevelingData = {
      ...DATA,
      gems: [{ ...DATA.gems[0], buyFloors: { chaos: 200 }, sellLowFloors: { chaos: 10 }, sellHighFloors: { chaos: 20 } }],
    }
    const [row] = computeRows(data, { gcpPrice: 3, gcpsNeeded: 20, cpd: 180, minListings: 0, minVolume: 0 })
    expect(row.recommend).toBe('skip')
  })
})

describe('transfig', () => {
  it('orderStatMaxOf3 matches C(i,2)/C(N,3) identity and collapses to max for n<=3', () => {
    expect(orderStatMaxOf3([])).toBe(0)
    expect(orderStatMaxOf3([5])).toBe(5)
    expect(orderStatMaxOf3([1, 9, 5])).toBe(9) // n=3: max of all 3 draws is deterministic
    // n=4, uniform-ish: EV should land strictly between the median and the max.
    const ev = orderStatMaxOf3([1, 2, 3, 4])
    expect(ev).toBeGreaterThan(2)
    expect(ev).toBeLessThan(4)
  })

  const TRANSFIG_DATA: TransfigData = {
    bases: [
      {
        baseName: 'Base Blue',
        color: 'blue',
        baseFloors: { chaos: 2 },
        baseFloorsMax: { chaos: 5 },
        baseMaxLevel: 20,
        variants: [
          {
            gemName: 'Blue Variant A',
            floors: { chaos: 10 },
            floorsMax: { chaos: 50 },
            maxLevel: 20,
            listings: 20,
            listingsMax: 10,
            volume24h: 50,
            volume24hMax: 20,
          },
          {
            gemName: 'Blue Variant B',
            floors: { chaos: 4 },
            floorsMax: { chaos: 30 },
            maxLevel: 20,
            listings: 20,
            listingsMax: 10,
            volume24h: 50,
            volume24hMax: 20,
          },
        ],
      },
    ],
    exceptionalPrices: {
      Empower: { chaos: 100 },
      Enlighten: { chaos: 500 },
      Enhance: { chaos: 10 },
    },
  }

  it('computes divine font EV as the documented 2.5/6/91.5 blend', () => {
    const result = computeDivineFont(TRANSFIG_DATA, { l20: false, cpd: 180 })
    expect(result.exceptionalEv).toBe(500) // max of a fixed pool of exactly 3
    expect(result.colorEV.blue).toBeGreaterThan(0)
    expect(result.colorEV.red).toBe(0)
    expect(result.best?.baseName).toBe('Base Blue')
    const expected =
      0.025 * result.exceptionalEv + 0.06 * Math.max(result.best?.netEv ?? 0, 0) + 0.915 * result.bestColorEv
    expect(result.fontEv).toBeCloseTo(expected, 8)
    expect(result.evPerLab).toBeCloseTo(result.fontEv * 2, 8)
    expect(result.evPerHour).toBeCloseTo(result.evPerLab * (3600 / 360), 8)
  })

  it('prices below-minVolume variants at 0 but still counts them in N', () => {
    const withoutFilter = computeDivineFont(TRANSFIG_DATA, { l20: false, cpd: 180, minVolume: 0 })
    const withFilter = computeDivineFont(TRANSFIG_DATA, { l20: false, cpd: 180, minVolume: 1000 })
    expect(withFilter.colorEV.blue).toBe(0)
    expect(withoutFilter.colorEV.blue).toBeGreaterThan(0)
  })
})
