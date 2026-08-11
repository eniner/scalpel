import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./prices', () => ({
  lookupPrice: vi.fn((name: string) => {
    const map: Record<string, { divineValue: number }> = {
      'Divine Orb': { divineValue: 1 },
      'Exalted Orb': { divineValue: 1 / 150 },
      'Chaos Orb': { divineValue: 1 / 300 },
    }
    return map[name]
  }),
}))

import { listingAmountToDivine, summarizeDivineSamples } from './listing-divine'

describe('listingAmountToDivine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through divine amounts', () => {
    expect(listingAmountToDivine(5700, 'divine')).toBe(5700)
  })

  it('converts exalted via ninja rate', () => {
    expect(listingAmountToDivine(150, 'exa')).toBeCloseTo(1)
  })
})

describe('summarizeDivineSamples', () => {
  it('uses median of cheapest few', () => {
    const s = summarizeDivineSamples([5700, 100, 120, 110, 9000])
    expect(s.cheapestDivine).toBe(100)
    expect(s.estimateDivine).toBe(120)
    expect(s.pricedCount).toBe(5)
  })

  it('returns nulls when empty', () => {
    expect(summarizeDivineSamples([])).toMatchObject({
      cheapestDivine: null,
      estimateDivine: null,
      pricedCount: 0,
    })
  })
})
