import { describe, expect, it } from 'vitest'
import { listingMatchesSupportLink, matchSupportLinkOrder, type WarrantSkill } from '@shared/warrants'

const linked = [
  { name: 'Greater Added Cold', tier: 3 },
  { name: 'Faster Attacks', tier: 2 },
  { name: 'Greater Pierce', tier: 3 },
  { name: 'Return', tier: 3 },
]

describe('matchSupportLinkOrder', () => {
  it('matches ordered subsequence', () => {
    expect(
      matchSupportLinkOrder(
        linked,
        [
          { name: 'Greater Added Cold', tier: 3 },
          { name: 'Greater Pierce', tier: 3 },
          { name: 'Return', tier: 3 },
        ],
        'ordered',
      ),
    ).toBe(true)
  })

  it('rejects wrong order', () => {
    expect(
      matchSupportLinkOrder(
        linked,
        [
          { name: 'Return', tier: 3 },
          { name: 'Greater Pierce', tier: 3 },
        ],
        'ordered',
      ),
    ).toBe(false)
  })

  it('requires exact full link', () => {
    expect(
      matchSupportLinkOrder(linked, linked.map((s) => ({ name: s.name, tier: s.tier })), 'exact'),
    ).toBe(true)
    expect(
      matchSupportLinkOrder(
        linked,
        [
          { name: 'Greater Added Cold', tier: 3 },
          { name: 'Greater Pierce', tier: 3 },
        ],
        'exact',
      ),
    ).toBe(false)
  })
})

describe('listingMatchesSupportLink', () => {
  const skills: WarrantSkill[] = [
    {
      hash: 1,
      name: 'Kinetic Blast of Clustering',
      supports: linked.map((s, i) => ({ hash: i, name: s.name, tier: s.tier })),
    },
    { hash: 2, name: 'Flame Dash', supports: [{ hash: 9, name: 'Greater Faster Casting', tier: 3 }] },
  ]

  it('checks supports on the focused skill link', () => {
    expect(
      listingMatchesSupportLink(
        skills,
        [
          { name: 'Greater Pierce', tier: 3 },
          { name: 'Return', tier: 3 },
        ],
        {
          presence: 'all',
          order: 'ordered',
          linkSkill: 'Kinetic Blast of Clustering',
          wantSkills: ['Kinetic Blast of Clustering'],
        },
      ),
    ).toBe(true)
  })
})
