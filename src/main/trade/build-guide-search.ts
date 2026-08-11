import { getItemClasses } from '@shared/data/items/item-classes'
import { getPoeVersion } from '../game-state'
import { matchModToStat } from './stat-matcher/mod-matcher'
import { ARMOUR_CLASSES, WEAPON_CLASSES } from './stat-matcher/item-classes'
import { GEM_LEVEL_MOD } from './stat-matcher/producers/explicits'
import type { StatFilter } from './trade'

const RUNE_BASE_PREFIX = /^(Runeforged|Runemastered)\s+/i

const QUALIFIER_BY_ITEM_CLASS: Record<string, string> = {
  Charms: 'Charm',
  Flasks: 'Flask',
  Jewels: 'Jewel',
}

type MatchModType = 'explicit' | 'crafted' | 'implicit' | 'enchant' | 'rune'

/** Strip build-planner base hints like `(Str/Dex Base)` from a base type name. */
export function normalizeGuideBaseType(raw: string): string {
  return raw
    .trim()
    .replace(/\s*\([^)]*\bBase\b[^)]*\)\s*$/i, '')
    .trim()
}

/** Resolve trade item class from base-type lookup, then slot mapping. */
export function resolveGuideItemClass(baseType: string, slotClass?: string): string {
  const normalized = normalizeGuideBaseType(baseType)
  if (normalized) {
    const classes = getItemClasses(getPoeVersion())
    const candidates = [normalized]
    const withoutRune = normalized.replace(RUNE_BASE_PREFIX, '')
    if (withoutRune !== normalized) candidates.push(withoutRune)
    for (const name of candidates) {
      for (const [cls, info] of Object.entries(classes)) {
        if (info.bases?.some((b) => b.name === name)) return cls
      }
    }
  }
  return slotClass?.trim() ?? ''
}

function isTradeStatFilter(f: StatFilter): boolean {
  return f.id !== 'misc.basetype' && f.type !== 'misc'
}

/** Keep the highest-priority trade-stat filters (guide order), preserve misc/base. */
export function limitGuideStatFilters(filters: readonly StatFilter[], maxExplicit: number): StatFilter[] {
  const misc = filters.filter((f) => !isTradeStatFilter(f))
  const stats = filters.filter((f) => isTradeStatFilter(f)).slice(0, maxExplicit)
  return [...misc, ...stats]
}

/** Normalize a guide stat-priority line before stat matching. */
export function normalizeGuideModLine(raw: string): string {
  return raw
    .replace(/\s*\(local\)\s*$/i, '')
    .replace(/\bdamage\b/gi, 'Damage')
    .trim()
}

/** Strip GGG / MaxRoll markup from build-guide text. */
export function stripGuideMarkup(text: string): string {
  return text
    .replace(/<[^>{}]+>\{([^}]*)\}/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\{([^}]*)\}/g, '$1')
    .replace(/\r\n/g, '\n')
    .trim()
}

/** Pull numbered stat-priority lines from guide notes (`1. …`, `2. …`). */
export function parseGuideStatLines(notes?: string): string[] {
  if (!notes?.trim()) return []
  const clean = stripGuideMarkup(notes)
  return clean
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
}

export type GuideModKind =
  | 'implicit'
  | 'explicit'
  | 'enchant'
  | 'fractured'
  | 'desecrated'
  | 'rune'
  | 'crafted'

export type GuideModLine = {
  text: string
  kind?: GuideModKind | string
}

export type BuildGuideStatFilterOpts = {
  /**
   * When true, set `min` from the rolled value on each matched line (upgrade
   * searches). Gem-level mods still pin min=max. Presence-only when false.
   */
  useStatMinimums?: boolean
  /** Parallel kinds for `modLines` when passing plain strings. */
  kinds?: Array<GuideModKind | string | undefined>
}

export type BuildGuideStatFiltersResult = {
  filters: StatFilter[]
  matched: string[]
  unmatched: string[]
}

function kindToMatchTypes(kind: string | undefined): MatchModType[] {
  switch ((kind ?? 'explicit').toLowerCase()) {
    case 'crafted':
      return ['crafted', 'explicit']
    case 'enchant':
      return ['enchant', 'explicit']
    case 'rune':
      return ['rune', 'explicit']
    case 'implicit':
      return ['implicit', 'explicit']
    case 'fractured':
    case 'desecrated':
    case 'explicit':
    default:
      return ['explicit', 'crafted', 'enchant', 'rune', 'implicit']
  }
}

function filterTypeForStatId(statId: string): string {
  const prefix = statId.split('.')[0]
  if (
    prefix === 'crafted' ||
    prefix === 'enchant' ||
    prefix === 'rune' ||
    prefix === 'implicit' ||
    prefix === 'fractured'
  ) {
    return prefix
  }
  return 'explicit'
}

function normalizeInputLines(
  modLines: readonly string[] | readonly GuideModLine[],
  kinds?: Array<GuideModKind | string | undefined>,
): GuideModLine[] {
  return modLines.map((entry, i) => {
    if (typeof entry === 'string') {
      return { text: entry, kind: kinds?.[i] }
    }
    return { text: entry.text, kind: entry.kind ?? kinds?.[i] }
  })
}

/** Convert guide priority mod lines into trade stat filters. */
export function buildGuideStatFilters(
  modLines: readonly string[] | readonly GuideModLine[],
  itemClass?: string,
  opts?: BuildGuideStatFilterOpts,
): StatFilter[] {
  return buildGuideStatFiltersDetailed(modLines, itemClass, opts).filters
}

/** Like buildGuideStatFilters, but also reports which lines matched. */
export function buildGuideStatFiltersDetailed(
  modLines: readonly string[] | readonly GuideModLine[],
  itemClass?: string,
  opts?: BuildGuideStatFilterOpts,
): BuildGuideStatFiltersResult {
  const preferQualifier = QUALIFIER_BY_ITEM_CLASS[itemClass ?? ''] ?? null
  const preferLocal = itemClass != null && (ARMOUR_CLASSES.has(itemClass) || WEAPON_CLASSES.has(itemClass))
  const useStatMinimums = opts?.useStatMinimums === true
  const seen = new Set<string>()
  const filters: StatFilter[] = []
  const matched: string[] = []
  const unmatched: string[] = []

  for (const line of normalizeInputLines(modLines, opts?.kinds)) {
    const cleaned = normalizeGuideModLine(line.text)
    if (!cleaned) continue

    // Bonded rune extras aren't standard tradeable item mods.
    if (/^bonded:/i.test(cleaned)) {
      unmatched.push(cleaned)
      continue
    }

    let matchedStat: { statId: string; value: number | null; option?: number } | null = null
    for (const modType of kindToMatchTypes(line.kind)) {
      const hit = matchModToStat(cleaned, preferLocal, modType, false, preferQualifier)
      if (hit) {
        matchedStat = hit
        break
      }
    }

    if (!matchedStat || seen.has(matchedStat.statId)) {
      if (!matchedStat) unmatched.push(cleaned)
      continue
    }
    seen.add(matchedStat.statId)

    let min: number | null = null
    let max: number | null = null
    if (GEM_LEVEL_MOD.test(cleaned) && matchedStat.value != null) {
      min = matchedStat.value
      max = matchedStat.value
    } else if (useStatMinimums && matchedStat.value != null && Number.isFinite(matchedStat.value)) {
      min = matchedStat.value
    }

    filters.push({
      id: matchedStat.statId,
      text: cleaned,
      value: matchedStat.value,
      min,
      max,
      enabled: true,
      type: filterTypeForStatId(matchedStat.statId),
      option: matchedStat.option,
    })
    matched.push(cleaned)
  }

  return { filters, matched, unmatched }
}

export function buildBaseTypeStatFilter(baseType: string, enabled = true): StatFilter {
  return {
    id: 'misc.basetype',
    text: normalizeGuideBaseType(baseType),
    value: null,
    min: null,
    max: null,
    enabled,
    type: 'misc',
  }
}
