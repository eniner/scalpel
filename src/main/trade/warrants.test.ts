import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fingerprintSkills, skillKey, type WarrantListing, type WarrantSkill } from '@shared/warrants'
import {
  groupListings,
  isUsableAsk,
  priceToChaos,
  DEFAULT_MAX_ASK_DIVINE,
} from './warrants'

vi.mock('./prices', () => ({
  lookupPrice: vi.fn((name: string) => {
    const table: Record<string, { chaosValue: number }> = {
      'divine orb': { chaosValue: 200 },
      'mirror of kalandra': { chaosValue: 1_140_916 },
      'exalted orb': { chaosValue: 10 },
    }
    return table[name.toLowerCase()] ?? null
  }),
  refreshPrices: vi.fn(),
}))

vi.mock('../game-state', () => ({
  getPoeVersion: () => 1,
}))

vi.mock('./trade', () => ({
  fetchJson: vi.fn(),
}))

vi.mock('@shared/endpoints', () => ({
  getTradeUrls: () => ({
    search: () => 'https://example.test/search',
    fetch: () => 'https://example.test/fetch',
    webSearch: (league: string, id: string) => `https://example.test/trade/${league}/${id}`,
    webListing: (league: string, qid: string, listingId: string) =>
      `https://example.test/trade/${league}/${qid}/${listingId}`,
  }),
}))

const sampleSkills: WarrantSkill[] = [
  {
    hash: 1,
    name: 'Determination',
    supports: [
      { hash: 2, name: 'Increased Area of Effect', tier: 2 },
      { hash: 3, name: 'More Duration', tier: 2 },
    ],
  },
  {
    hash: 4,
    name: 'Pride',
    supports: [{ hash: 5, name: 'Greater Area of Effect', tier: 3 }],
  },
]

function listing(partial: Partial<WarrantListing> & Pick<WarrantListing, 'id' | 'fingerprint'>): WarrantListing {
  return {
    queryId: 'q',
    mercenaryName: 'Merc',
    build: 'Infamous Manyshot',
    level: 80,
    skills: sampleSkills,
    skillKey: skillKey(sampleSkills),
    priceAmount: 1,
    priceCurrency: 'divine',
    chaosValue: 200,
    usableAsk: true,
    instantBuyout: false,
    whisper: '@seller Hi, I would like to buy your Mercenary Warrant',
    account: 'seller',
    characterName: 'SellerChar',
    online: true,
    indexed: null,
    icon: null,
    ...partial,
  }
}

describe('warrant skill fingerprints', () => {
  it('preserves skill and support link order', () => {
    expect(fingerprintSkills(sampleSkills)).toBe(
      'Determination[Increased Area of Effect:t2+More Duration:t2] | Pride[Greater Area of Effect:t3]',
    )
  })

  it('changes fingerprint when support order changes', () => {
    const swapped: WarrantSkill[] = [
      {
        ...sampleSkills[0],
        supports: [...sampleSkills[0].supports].reverse(),
      },
      sampleSkills[1],
    ]
    expect(fingerprintSkills(swapped)).not.toBe(fingerprintSkills(sampleSkills))
  })

  it('builds a sorted skill-only key for coarse filtering', () => {
    expect(skillKey(sampleSkills)).toBe('Determination, Pride')
  })
})

describe('priceToChaos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes chaos through unchanged', () => {
    expect(priceToChaos(15, 'chaos')).toBe(15)
  })

  it('converts divine via ninja rate', () => {
    expect(priceToChaos(3, 'divine')).toBe(600)
  })

  it('converts mirrors (caller should treat as outlier)', () => {
    expect(priceToChaos(1, 'mirror')).toBe(1_140_916)
  })

  it('returns null for unknown currencies', () => {
    expect(priceToChaos(1, 'fracturing-orb')).toBeNull()
  })
})

describe('isUsableAsk', () => {
  const opts = { maxAskChaos: DEFAULT_MAX_ASK_DIVINE * 200 }

  it('accepts normal divine asks under the cap', () => {
    expect(isUsableAsk(600, 'divine', opts)).toBe(true)
  })

  it('rejects mirrors even when under a huge chaos cap', () => {
    expect(isUsableAsk(1_140_916, 'mirror', { maxAskChaos: 10_000_000 })).toBe(false)
  })

  it('rejects joke chaos ceilings', () => {
    expect(isUsableAsk(9_999_999, 'chaos', opts)).toBe(false)
  })

  it('rejects null / non-finite', () => {
    expect(isUsableAsk(null, 'chaos', opts)).toBe(false)
    expect(isUsableAsk(Number.NaN, 'chaos', opts)).toBe(false)
  })
})

describe('groupListings', () => {
  it('ranks by floor and uses cheapest usable sample', () => {
    const fp = fingerprintSkills(sampleSkills)
    const groups = groupListings([
      listing({
        id: 'expensive',
        fingerprint: fp,
        chaosValue: 800,
        priceAmount: 4,
        usableAsk: true,
        account: 'rich',
      }),
      listing({
        id: 'cheap',
        fingerprint: fp,
        chaosValue: 200,
        priceAmount: 1,
        usableAsk: true,
        account: 'budget',
      }),
      listing({
        id: 'mirror',
        fingerprint: fp,
        chaosValue: 1_140_916,
        priceAmount: 1,
        priceCurrency: 'mirror',
        usableAsk: false,
        account: 'troll',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].usableCount).toBe(2)
    expect(groups[0].minChaos).toBe(200)
    expect(groups[0].medianChaos).toBe(500)
    expect(groups[0].maxChaos).toBe(800)
    expect(groups[0].sample.id).toBe('cheap')
    expect(groups[0].listings.map((l) => l.id)).toEqual(['cheap', 'expensive', 'mirror'])
  })

  it('ignores outliers when computing floor/median', () => {
    const fp = 'solo'
    const groups = groupListings([
      listing({
        id: 'ok',
        fingerprint: fp,
        build: 'Sniper',
        chaosValue: 100,
        usableAsk: true,
      }),
      listing({
        id: 'joke',
        fingerprint: fp,
        build: 'Sniper',
        chaosValue: 9_999_999,
        priceAmount: 9_999_999,
        priceCurrency: 'chaos',
        usableAsk: false,
      }),
    ])
    expect(groups[0].minChaos).toBe(100)
    expect(groups[0].medianChaos).toBe(100)
    expect(groups[0].maxChaos).toBe(100)
  })
})
