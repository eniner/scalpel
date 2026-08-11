import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../game-state', () => ({
  getPoeVersion: () => 2 as const,
}))

import { _setStatEntriesForTests } from './stat-matcher'
import {
  buildGuideStatFilters,
  buildGuideStatFiltersDetailed,
  limitGuideStatFilters,
  normalizeGuideBaseType,
  normalizeGuideModLine,
  parseGuideStatLines,
  resolveGuideItemClass,
  stripGuideMarkup,
} from './build-guide-search'

describe('build-guide-search parsing', () => {
  beforeEach(() => {
    _setStatEntriesForTests([
      { id: 'explicit.stat_es_inc', text: '#% increased Energy Shield', type: 'explicit' },
      { id: 'explicit.stat_spirit', text: '# to Spirit', type: 'explicit' },
      { id: 'explicit.stat_fire_res', text: '+#% to Fire Resistance', type: 'explicit' },
    ])
  })
  it('strips GGG markup from stat priority blocks', () => {
    const raw =
      '<b>{<m>{Stat Priority}}\r\n-------------------\r\n<s>{1. # to Level of all Minion Skills\r\n2. Allies in your Presence deal #% increased Damage}'
    expect(stripGuideMarkup(raw)).toContain('Stat Priority')
    expect(stripGuideMarkup(raw)).toContain('1. # to Level of all Minion Skills')
  })

  it('extracts numbered mod lines', () => {
    const notes = `Rattling Sceptre

Stat Priority
-------------------
1. Allies in your Presence deal # to # added Attack Cold Damage
2. Allies in your Presence deal #% increased Damage
3. # to Level of all Minion Skills`
    expect(parseGuideStatLines(notes)).toEqual([
      'Allies in your Presence deal # to # added Attack Cold Damage',
      'Allies in your Presence deal #% increased Damage',
      '# to Level of all Minion Skills',
    ])
  })

  it('returns empty for missing notes', () => {
    expect(parseGuideStatLines(undefined)).toEqual([])
    expect(parseGuideStatLines('')).toEqual([])
  })

  it('strips base-type hints from guide base names', () => {
    expect(normalizeGuideBaseType('Cowled Helm (Str/Dex Base)')).toBe('Cowled Helm')
    expect(normalizeGuideBaseType('Runeforged Vagabond Armour (Str/Dex Base)')).toBe('Runeforged Vagabond Armour')
    expect(normalizeGuideBaseType('Rattling Sceptre')).toBe('Rattling Sceptre')
  })

  it('normalizes mod lines for stat matching', () => {
    expect(normalizeGuideModLine('Adds # to # Fire damage to Attacks')).toBe(
      'Adds # to # Fire Damage to Attacks',
    )
    expect(normalizeGuideModLine('# to Armour (local)')).toBe('# to Armour')
  })

  it('extracts armour and accessory priority lines', () => {
    expect(parseGuideStatLines(`1. #% to Fire Resistance\n2. # to Armour (local)`)).toEqual([
      '#% to Fire Resistance',
      '# to Armour (local)',
    ])
    expect(parseGuideStatLines('1. #% to all Elemental Resistances')).toEqual([
      '#% to all Elemental Resistances',
    ])
  })

  it('applies rolled minimums when useStatMinimums is set', () => {
    const filters = buildGuideStatFilters(
      ['109% increased Energy Shield', '+61 to Spirit', '+45% to Fire Resistance'],
      'Body Armours',
      { useStatMinimums: true },
    )
    expect(filters.length).toBeGreaterThan(0)
    for (const f of filters) {
      expect(f.min).not.toBeNull()
    }
  })

  it('keeps presence-only filters by default', () => {
    const filters = buildGuideStatFilters(['109% increased Energy Shield'], 'Body Armours')
    expect(filters.length).toBeGreaterThan(0)
    expect(filters.every((f) => f.min == null)).toBe(true)
  })

  it('matches crafted lines via crafted type hint', () => {
    _setStatEntriesForTests([
      { id: 'crafted.stat_cast', text: '#% increased Cast Speed', type: 'crafted' },
      { id: 'explicit.stat_cast', text: '#% increased Cast Speed', type: 'explicit' },
    ])
    const { filters, matched, unmatched } = buildGuideStatFiltersDetailed(
      [{ text: '46% increased Cast Speed', kind: 'crafted' }],
      'Wands',
      { useStatMinimums: true },
    )
    expect(unmatched).toEqual([])
    expect(matched).toEqual(['46% increased Cast Speed'])
    expect(filters[0]?.id).toBe('crafted.stat_cast')
    expect(filters[0]?.min).toBe(46)
  })

  it('skips Bonded rune lines as unmatched', () => {
    const { filters, unmatched } = buildGuideStatFiltersDetailed(
      [{ text: 'Bonded: Leeches 1% of maximum Life when you Cast a Spell', kind: 'rune' }],
      'Wands',
    )
    expect(filters).toEqual([])
    expect(unmatched[0]).toMatch(/^Bonded:/i)
  })

  it('resolves item class from slot or base type', () => {
    expect(resolveGuideItemClass('Rattling Sceptre', '')).toBe('Sceptres')
    expect(resolveGuideItemClass('', 'Helmets')).toBe('Helmets')
    expect(resolveGuideItemClass('Runeforged Noble Greathelm (Str Base)', '')).toBe('Helmets')
    expect(resolveGuideItemClass('Runeforged Avian Targe (Str/Dex Base)', 'Shields')).toBe('Shields')
  })

  it('limits explicit stat filters while preserving order', () => {
    const filters = [
      { id: 'a', type: 'explicit' as const, text: '1', value: null, min: null, max: null, enabled: true },
      { id: 'b', type: 'explicit' as const, text: '2', value: null, min: null, max: null, enabled: true },
      { id: 'c', type: 'explicit' as const, text: '3', value: null, min: null, max: null, enabled: true },
      { id: 'd', type: 'explicit' as const, text: '4', value: null, min: null, max: null, enabled: true },
    ]
    expect(limitGuideStatFilters(filters, 2).map((f) => f.id)).toEqual(['a', 'b'])
  })
})
