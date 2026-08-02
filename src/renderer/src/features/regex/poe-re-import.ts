import { MAP_MODS } from '@shared/data/regex/map-mods'
import type { RegexPreset } from '@shared/types'

/** Known Scalpel Maps qualifier IDs (see Qualifiers.tsx). */
const KNOWN_QUALIFIERS = new Set([
  'quantity',
  'packsize',
  'morecurrency',
  'morescarabs',
  'moremaps',
  'rarity',
  'quality',
  'quality_packsize',
  'quality_rarity',
  'quality_currency',
  'quality_divination',
  'quality_scarab',
])

const KNOWN_MOD_IDS = new Set(MAP_MODS.map((m) => m.id))

/** Mods poe.re flags `nm`. Matches its own `isNightmareId` (a raw `options.nm` test),
 *  so this is the same set upstream filters on -- Scalpel's NIGHTMARE_REGROUPED is a
 *  display-grouping concern only and deliberately plays no part here. */
const NIGHTMARE_MOD_IDS = new Set(MAP_MODS.filter((m) => m.nightmare).map((m) => m.id))

/** Subset of poe.re `SavedSettings.map` we understand. */
export interface PoeReMapSettings {
  badIds?: number[]
  goodIds?: number[]
  allGoodMods?: boolean
  quantity?: string
  packsize?: string
  itemRarity?: string
  mapDropChance?: string
  displayNightmareMods?: boolean
  quality?: {
    regular?: string
    currency?: string
    divination?: string
    rarity?: string
    packSize?: string
    scarab?: string
  }
  anyQuality?: boolean
  rarity?: unknown
  corrupted?: unknown
  unidentified?: unknown
  tradeEightModOnly?: unknown
  tradeExcludeValdo?: unknown
  tradeExcludeShaperElder?: unknown
  customText?: unknown
  optimizeQuant?: unknown
  optimizePacksize?: unknown
  optimizeQuality?: unknown
}

export interface PoeReImportResult {
  /** Preset ready for MapsGenerator.applyPreset / loadPreset. */
  preset: RegexPreset
  /** Mod IDs from the export that aren't in Scalpel's vendored map-mod list. */
  unknownModIds: number[]
  /** Nightmare mods dropped because the profile had poe.re's Nightmare toggle off. */
  nightmareSkipped: number
  /** poe.re fields we saw but don't map into Scalpel Maps yet. */
  unsupported: string[]
  /** Profile name from the export, if present. */
  profileName: string | null
}

function parseMin(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function setQualifier(out: Record<string, number>, id: string, raw: unknown): void {
  if (!KNOWN_QUALIFIERS.has(id)) return
  const n = parseMin(raw)
  if (n != null) out[id] = n
}

/** Decode a poe.re profile export string (Base64 JSON, UTF-8-safe). */
export function decodePoeReExport(raw: string): unknown {
  const trimmed = raw.trim().replace(/\s+/g, '')
  if (!trimmed) throw new Error('Paste a poe.re export string first.')
  let binary: string
  try {
    binary = atob(trimmed)
  } catch {
    throw new Error('Not a valid Base64 export string.')
  }
  // Mirror poe.re's btoa(unescape(encodeURIComponent(...))) encode path.
  let json: string
  try {
    json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
  } catch {
    throw new Error('Could not decode export bytes as UTF-8.')
  }
  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new Error('Export string is not valid JSON after decode.')
  }
}

/** Pull the map settings object out of a decoded export (delta or full profile). */
export function extractPoeReMapSettings(decoded: unknown): {
  map: PoeReMapSettings
  profileName: string | null
  version: number | null
} {
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Export payload is empty.')
  }
  const root = decoded as Record<string, unknown>

  // Full / delta SavedSettings shape: { name?, map: {...}, ... }
  if (root.map && typeof root.map === 'object') {
    return {
      map: root.map as PoeReMapSettings,
      profileName: typeof root.name === 'string' ? root.name : null,
      version: typeof root.version === 'number' ? root.version : null,
    }
  }

  // Bare map object paste (goodIds/badIds at top level).
  if (Array.isArray(root.goodIds) || Array.isArray(root.badIds)) {
    return { map: root as PoeReMapSettings, profileName: null, version: null }
  }

  // Multi-profile bag: { active, profiles: { [name]: SavedSettings } }
  if (root.profiles && typeof root.profiles === 'object') {
    const profiles = root.profiles as Record<string, Record<string, unknown>>
    const active = typeof root.active === 'string' ? root.active : null
    const name = (active && profiles[active] ? active : null) ?? Object.keys(profiles)[0] ?? null
    if (!name || !profiles[name]) throw new Error('Export has no profiles to import.')
    const profile = profiles[name]
    if (!profile.map || typeof profile.map !== 'object') {
      throw new Error(`Profile "${name}" has no map settings.`)
    }
    return {
      map: profile.map as PoeReMapSettings,
      profileName: typeof profile.name === 'string' ? profile.name : name,
      version: typeof profile.version === 'number' ? profile.version : null,
    }
  }

  throw new Error('No map settings found in this export (Maps page profile only).')
}

function collectUnsupported(map: PoeReMapSettings): string[] {
  const out: string[] = []
  // poe.re's anyQuality (on by default) ORs every quality qualifier into one term;
  // Scalpel's buildQualifierRegex always ANDs them. Only diverges past one value.
  // The default never shows up in a delta export, so this cannot be read off a key.
  if (map.anyQuality !== false && countQualityValues(map) > 1) {
    out.push('quality match-any (Scalpel requires all of them)')
  }
  if (map.rarity != null) out.push('map rarity include/exclude')
  if (map.corrupted != null) out.push('corrupted filter')
  if (map.unidentified != null) out.push('unidentified filter')
  if (map.tradeEightModOnly != null) out.push('8-mod trade filter')
  if (map.tradeExcludeValdo != null) out.push('exclude Valdo maps')
  if (map.tradeExcludeShaperElder != null) out.push('exclude Shaper/Elder maps')
  if (map.customText != null) out.push('custom text')
  if (map.optimizeQuant != null || map.optimizePacksize != null || map.optimizeQuality != null) {
    out.push('optimize number scrubbing')
  }
  return out
}

function countQualityValues(map: PoeReMapSettings): number {
  const q = map.quality
  if (!q) return 0
  return [q.regular, q.currency, q.divination, q.rarity, q.packSize, q.scarab].filter((v) => parseMin(v) != null).length
}

function filterKnownIds(ids: unknown): { kept: number[]; unknown: number[] } {
  const kept: number[] = []
  const unknown: number[] = []
  if (!Array.isArray(ids)) return { kept, unknown }
  for (const raw of ids) {
    const id = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(id)) continue
    if (KNOWN_MOD_IDS.has(id)) kept.push(id)
    else unknown.push(id)
  }
  return { kept, unknown }
}

/**
 * Convert a decoded poe.re export into a Scalpel Maps `RegexPreset` payload.
 * Mod IDs share poe.re's Generated.MapModsV3 namespace.
 */
export function mapPoeReToMapsPreset(
  map: PoeReMapSettings,
  opts?: { profileName?: string | null; id?: string },
): PoeReImportResult {
  const bad = filterKnownIds(map.badIds)
  const good = filterKnownIds(map.goodIds)
  const unknownModIds = [...new Set([...bad.unknown, ...good.unknown])]

  // With the Nightmare toggle off, poe.re strips nightmare mods out of the regex it
  // generates (getSelectedIds in OptimizedMapOutput.ts) even though they stay selected
  // in the profile. Scalpel's own nightmare flag only hides them from the picker, so
  // carrying the ids over verbatim would import a stricter filter than the source.
  const dropNightmare = map.displayNightmareMods === false
  const playable = (ids: number[]): number[] => (dropNightmare ? ids.filter((id) => !NIGHTMARE_MOD_IDS.has(id)) : ids)
  const avoid = playable(bad.kept)
  const want = playable(good.kept)
  const nightmareSkipped = bad.kept.length - avoid.length + (good.kept.length - want.length)

  const qualifiers: Record<string, number> = {}
  setQualifier(qualifiers, 'quantity', map.quantity)
  setQualifier(qualifiers, 'packsize', map.packsize)
  setQualifier(qualifiers, 'rarity', map.itemRarity)
  setQualifier(qualifiers, 'moremaps', map.mapDropChance)
  if (map.quality) {
    setQualifier(qualifiers, 'quality', map.quality.regular)
    setQualifier(qualifiers, 'quality_packsize', map.quality.packSize)
    setQualifier(qualifiers, 'quality_rarity', map.quality.rarity)
    setQualifier(qualifiers, 'quality_currency', map.quality.currency)
    setQualifier(qualifiers, 'quality_divination', map.quality.divination)
    setQualifier(qualifiers, 'quality_scarab', map.quality.scarab)
  }

  const wantMode: 'any' | 'all' = map.allGoodMods === false ? 'any' : 'all'
  const nightmare = map.displayNightmareMods !== false
  const profileName = opts?.profileName ?? null

  const name =
    profileName?.trim() && profileName.trim().toLowerCase() !== 'default' ? profileName.trim() : 'Imported from poe.re'

  const preset: RegexPreset = {
    id: opts?.id ?? `poe-re-${Date.now()}`,
    name,
    generator: 'maps',
    avoid,
    want,
    wantMode,
    qualifiers,
    nightmare,
  }

  return {
    preset,
    unknownModIds,
    nightmareSkipped,
    unsupported: collectUnsupported(map),
    profileName,
  }
}

export function poeReExportToMapsPreset(raw: string): PoeReImportResult {
  const decoded = decodePoeReExport(raw)
  const { map, profileName } = extractPoeReMapSettings(decoded)
  return mapPoeReToMapsPreset(map, { profileName })
}
