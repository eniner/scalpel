import { describe, expect, it } from 'vitest'
import {
  decodePoeReExport,
  extractPoeReMapSettings,
  poeReExportToMapsPreset,
} from './poe-re-import'

/** Encode the way poe.re does (UTF-8-safe Base64). */
function encodePoeRe(obj: unknown): string {
  const json = JSON.stringify(obj)
  return btoa(unescape(encodeURIComponent(json)))
}

describe('decodePoeReExport', () => {
  it('round-trips a UTF-8 profile delta', () => {
    const encoded = encodePoeRe({ map: { badIds: [1], goodIds: [2] }, name: 'My Maps' })
    expect(decodePoeReExport(encoded)).toEqual({
      map: { badIds: [1], goodIds: [2] },
      name: 'My Maps',
    })
  })

  it('rejects garbage', () => {
    expect(() => decodePoeReExport('not-base64!!!')).toThrow(/Base64/i)
  })
})

describe('extractPoeReMapSettings', () => {
  it('reads nested map from a SavedSettings-shaped export', () => {
    const { map, profileName } = extractPoeReMapSettings({
      name: 'juice',
      map: { badIds: [-2050206104], goodIds: [] },
    })
    expect(profileName).toBe('juice')
    expect(map.badIds).toEqual([-2050206104])
  })

  it('reads a multi-profile bag', () => {
    const { map, profileName } = extractPoeReMapSettings({
      active: 'default',
      profiles: {
        default: { name: 'default', map: { goodIds: [-2038489408], allGoodMods: false } },
      },
    })
    expect(profileName).toBe('default')
    expect(map.goodIds).toEqual([-2038489408])
    expect(map.allGoodMods).toBe(false)
  })
})

describe('poeReExportToMapsPreset', () => {
  it('maps avoid/want IDs, wantMode, qualifiers, and nightmare', () => {
    const encoded = encodePoeRe({
      name: 'League start',
      map: {
        badIds: [-2050206104, -2038489408, 999999999],
        goodIds: [-2038489408],
        allGoodMods: false,
        quantity: '80',
        packsize: '40',
        itemRarity: '50',
        mapDropChance: '15',
        displayNightmareMods: true,
        quality: { regular: '20', scarab: '10' },
        tradeExcludeValdo: true,
      },
    })
    const result = poeReExportToMapsPreset(encoded)
    expect(result.preset.generator).toBe('maps')
    expect(result.preset.name).toBe('League start')
    expect(result.preset.avoid).toEqual([-2050206104, -2038489408])
    expect(result.preset.want).toEqual([-2038489408])
    expect(result.preset.wantMode).toBe('any')
    expect(result.preset.nightmare).toBe(true)
    expect(result.preset.qualifiers).toEqual({
      quantity: 80,
      packsize: 40,
      rarity: 50,
      moremaps: 15,
      quality: 20,
      quality_scarab: 10,
    })
    expect(result.unknownModIds).toContain(999999999)
    expect(result.unsupported).toContain('exclude Valdo maps')
  })

  it('defaults wantMode to all and nightmare to true when omitted (poe.re defaults)', () => {
    const encoded = encodePoeRe({
      map: { badIds: [-2050206104] },
    })
    const result = poeReExportToMapsPreset(encoded)
    expect(result.preset.wantMode).toBe('all')
    expect(result.preset.nightmare).toBe(true)
    expect(result.preset.name).toBe('Imported from poe.re')
  })
})
