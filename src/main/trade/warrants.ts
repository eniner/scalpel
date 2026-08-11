/**
 * Mercenary Warrant live trade scanner.
 *
 * Trade fetch payloads include `mercenarySkills` with support link order — we
 * fingerprint that, convert ask prices to chaos via poe.ninja rates, and group
 * identical skill packages so the Scalpel Warrants tab can rank by market floor.
 *
 * Default scan pulls the *cheap* end of the market (sort asc + divine max) and
 * strips mirror / joke asks before computing floor / median. Ranking by price
 * desc without a cap samples mirrors and 9999999c placeholders.
 */
import { getTradeUrls } from '@shared/endpoints'
import {
  fingerprintSkills,
  listingMatchesSupportLink,
  parseTradeSupportText,
  skillKey,
  type SupportLinkOrder,
  type SupportPresenceMode,
  type WantSupportFilter,
  type WarrantListing,
  type WarrantScanResult,
  type WarrantSkill,
  type WarrantSkillGroup,
  type WarrantSupport,
} from '@shared/warrants'
import { getPoeVersion } from '../game-state'
import { lookupPrice, refreshPrices } from './prices'
import { ensureStatsLoaded, getStatEntries } from './stat-matcher/stats-cache'
import { fetchJson } from './trade'

/** Trade site currency option → poe.ninja item name. */
const TRADE_CURRENCY_NAMES: Record<string, string> = {
  chaos: 'Chaos Orb',
  divine: 'Divine Orb',
  exalted: 'Exalted Orb',
  exa: 'Exalted Orb',
  mirror: 'Mirror of Kalandra',
  alch: 'Orb of Alchemy',
  alt: 'Orb of Alteration',
  chrom: 'Chromatic Orb',
  fuse: 'Orb of Fusing',
  fusing: 'Orb of Fusing',
  jew: "Jeweller's Orb",
  jewellers: "Jeweller's Orb",
  chance: 'Orb of Chance',
  scour: 'Orb of Scouring',
  blessed: 'Blessed Orb',
  regret: 'Orb of Regret',
  regal: 'Regal Orb',
  vaal: 'Vaal Orb',
  gcp: "Gemcutter's Prism",
  annul: 'Orb of Annulment',
  aug: 'Orb of Augmentation',
  transmute: 'Orb of Transmutation',
}

/** Currencies that are never useful for warrant market floors. */
const JOKE_CURRENCIES = new Set(['mirror'])

/** Absolute chaos ceiling when ninja divine rate is unavailable. */
const FALLBACK_MAX_ASK_CHAOS = 50_000

/** Default trade-side + local cap in divine (real merc warrants rarely clear this). */
export const DEFAULT_MAX_ASK_DIVINE = 50

function propValue(
  properties: Array<{ name?: string; values?: Array<[string, number]> }> | undefined,
  name: string,
): string | null {
  const p = properties?.find((x) => x.name === name)
  return p?.values?.[0]?.[0] ?? null
}

function mercenaryName(
  properties: Array<{ name?: string; values?: Array<[string, number]> }> | undefined,
): string {
  const named = properties?.find((x) => !x.name && x.values?.[0]?.[0])
  return named?.values?.[0]?.[0] ?? 'Unknown Mercenary'
}

function parseSkills(raw: unknown): WarrantSkill[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s) => {
    const skill = s as {
      hash?: number
      name?: string
      icon?: string
      supports?: Array<{ hash?: number; name?: string; tier?: number }>
    }
    const supports: WarrantSupport[] = (skill.supports ?? []).map((sup) => ({
      hash: Number(sup.hash ?? 0),
      name: String(sup.name ?? 'Unknown Support'),
      tier: typeof sup.tier === 'number' ? sup.tier : undefined,
    }))
    return {
      hash: Number(skill.hash ?? 0),
      name: String(skill.name ?? 'Unknown Skill'),
      icon: skill.icon,
      supports,
    }
  })
}

export function getDivineChaosRate(): number | null {
  const info = lookupPrice('Divine Orb', 'Divine Orb')
  if (!info?.chaosValue || info.chaosValue <= 0) return null
  return info.chaosValue
}

export function priceToChaos(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null
  const key = currency.toLowerCase()
  if (key === 'chaos') return amount
  const ninjaName = TRADE_CURRENCY_NAMES[key]
  if (!ninjaName) return null
  const info = lookupPrice(ninjaName, ninjaName)
  if (!info?.chaosValue || info.chaosValue <= 0) return null
  return amount * info.chaosValue
}

export type UsableAskOpts = {
  /** Chaos ceiling for a "usable" ask. */
  maxAskChaos: number
  /** Drop mirror (and similar) currencies even when under the chaos cap. */
  excludeJokeCurrencies?: boolean
}

/**
 * Joke / mirror / absurd asks blow out medians. A usable ask is a finite chaos
 * value under the scan cap, and not priced in a joke currency.
 */
export function isUsableAsk(
  chaosValue: number | null | undefined,
  currency: string | null | undefined,
  opts: UsableAskOpts,
): boolean {
  if (chaosValue == null || !Number.isFinite(chaosValue) || chaosValue <= 0) return false
  if (chaosValue > opts.maxAskChaos) return false
  const key = (currency ?? '').toLowerCase()
  if ((opts.excludeJokeCurrencies ?? true) && JOKE_CURRENCIES.has(key)) return false
  return true
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function chaosSortKey(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY
}

export function groupListings(
  listings: WarrantListing[],
  rank: 'floor' | 'median' = 'floor',
): WarrantSkillGroup[] {
  const map = new Map<string, WarrantListing[]>()
  for (const listing of listings) {
    const key = listing.fingerprint || listing.id
    const bucket = map.get(key)
    if (bucket) bucket.push(listing)
    else map.set(key, [listing])
  }

  const groups: WarrantSkillGroup[] = []
  for (const [fingerprint, rows] of map) {
    const usable = rows.filter((r) => r.usableAsk)
    const priced = usable.map((r) => r.chaosValue!).filter((v) => Number.isFinite(v))
    const byChaosAsc = [...rows].sort((a, b) => chaosSortKey(a.chaosValue) - chaosSortKey(b.chaosValue))
    const sample = usable.length
      ? [...usable].sort((a, b) => chaosSortKey(a.chaosValue) - chaosSortKey(b.chaosValue))[0]
      : byChaosAsc[0]

    groups.push({
      fingerprint,
      skillKey: sample.skillKey,
      build: sample.build,
      count: rows.length,
      usableCount: usable.length,
      medianChaos: median(priced),
      minChaos: priced.length ? Math.min(...priced) : null,
      maxChaos: priced.length ? Math.max(...priced) : null,
      sample,
      listings: byChaosAsc,
    })
  }

  return groups.sort((a, b) => {
    if (rank === 'median') {
      return chaosSortKey(a.medianChaos) - chaosSortKey(b.medianChaos)
    }
    return chaosSortKey(a.minChaos) - chaosSortKey(b.minChaos)
  })
}

type RawFetchResult = {
  id?: string
  listing?: {
    indexed?: string
    price?: { amount?: number; currency?: string }
    whisper?: string
    fee?: number | string | null
    account?: {
      name?: string
      lastCharacterName?: string
      online?: boolean | { status?: string }
    }
  }
  item?: {
    icon?: string
    properties?: Array<{ name?: string; values?: Array<[string, number]> }>
    mercenarySkills?: unknown
  }
}

async function fetchBatches(ids: string[], queryId: string): Promise<RawFetchResult[]> {
  const urls = getTradeUrls(1)
  const out: RawFetchResult[] = []
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    if (i > 0) await new Promise((r) => setTimeout(r, 1100))
    const fetched = (await fetchJson(urls.fetch(batch.join(','), queryId))) as {
      result?: RawFetchResult[]
    }
    out.push(...(fetched.result ?? []))
  }
  return out
}

export type WarrantScanOptions = {
  /** Max listings to fetch (capped at 100; trade search returns up to 100 ids). */
  limit?: number
  /** Prefer online sellers when true. */
  onlineOnly?: boolean
  /** Require a listed price. */
  pricedOnly?: boolean
  /** Trade sort. Default `asc` (market floor). `desc` samples the joke/mirror tail. */
  sort?: 'asc' | 'desc'
  /**
   * Cap asks at this many divine (trade filter + local outlier band).
   * `null` disables the trade max; local outlier band still uses a fallback.
   * Default {@link DEFAULT_MAX_ASK_DIVINE}.
   */
  maxAskDivine?: number | null
  /** Drop mirror currencies from usable stats. Default true. */
  excludeJokeCurrencies?: boolean
  /** Skill names to require on the warrant (trade `mercenary.skill_*` filters). */
  wantSkills?: string[]
  /** `all` = AND filters, `any` = OR filters. Default `all`. */
  skillMatchMode?: 'all' | 'any'
  /** Support gems to require (trade `mercenary.support_*` filters). */
  wantSupports?: WantSupportFilter[]
  /** How supports combine on the trade query. Default `all`. */
  supportPresenceMode?: SupportPresenceMode
  /**
   * How supports must appear on the focused skill's link after fetch.
   * Trade cannot enforce order — `ordered` / `exact` are applied locally.
   */
  supportLinkOrder?: SupportLinkOrder
  /** Skill whose link is checked for support order. Defaults to first wantSkill. */
  linkSkill?: string | null
}

/**
 * Map one display skill name → trade site mercenary.skill_* ids.
 * Exact match first; also includes `Skill of …` transfigured variants when the
 * base name is selected (e.g. Kinetic Blast → Kinetic Blast of Clustering).
 */
export async function resolveMercenarySkillStatIdsForName(
  skillName: string,
): Promise<Array<{ id: string; text: string }>> {
  const key = skillName.trim().toLowerCase()
  if (!key) return []
  await ensureStatsLoaded()
  const merc = getStatEntries().filter((e) => e.id.startsWith('mercenary.skill_'))
  return merc.filter((e) => {
    const t = e.text.toLowerCase()
    return t === key || t.startsWith(`${key} of `)
  })
}

/** Resolve many skill names (deduped ids, flat). Prefer {@link buildMercenarySkillStatGroups}. */
export async function resolveMercenarySkillStatIds(
  skillNames: readonly string[],
): Promise<Array<{ id: string; text: string }>> {
  const out: Array<{ id: string; text: string }> = []
  const seen = new Set<string>()
  for (const name of skillNames) {
    for (const e of await resolveMercenarySkillStatIdsForName(name)) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
  }
  return out
}

/** Build trade `stats` groups so each selected skill is satisfied (variants OR'd). */
export async function buildMercenarySkillStatGroups(
  skillNames: readonly string[],
  mode: 'all' | 'any',
): Promise<{ groups: Array<{ type: string; filters: Array<{ id: string }> }>; resolved: number; missing: string[] }> {
  const cleaned = skillNames.map((s) => s.trim()).filter(Boolean)
  const missing: string[] = []
  const perSkill: Array<Array<{ id: string }>> = []
  for (const name of cleaned) {
    const ids = (await resolveMercenarySkillStatIdsForName(name)).map((e) => ({ id: e.id }))
    if (ids.length === 0) missing.push(name)
    else perSkill.push(ids)
  }
  if (perSkill.length === 0) {
    return { groups: [{ type: 'and', filters: [] }], resolved: 0, missing }
  }
  if (mode === 'any') {
    const seen = new Set<string>()
    const filters: Array<{ id: string }> = []
    for (const group of perSkill) {
      for (const f of group) {
        if (seen.has(f.id)) continue
        seen.add(f.id)
        filters.push(f)
      }
    }
    return { groups: [{ type: 'or', filters }], resolved: filters.length, missing }
  }
  // all: each selected skill becomes its own group (OR of its variants); groups AND together
  const groups = perSkill.map((filters) => ({
    type: filters.length > 1 ? 'or' : 'and',
    filters,
  }))
  return {
    groups,
    resolved: groups.reduce((n, g) => n + g.filters.length, 0),
    missing,
  }
}

/** Resolve one support filter → trade mercenary.support_* ids. */
export async function resolveMercenarySupportStatIdsForWant(
  want: WantSupportFilter,
): Promise<Array<{ id: string; text: string }>> {
  const key = want.name.trim().toLowerCase()
  if (!key) return []
  await ensureStatsLoaded()
  return getStatEntries()
    .filter((e) => e.id.startsWith('mercenary.support_'))
    .filter((e) => {
      const parsed = parseTradeSupportText(e.text)
      if (!parsed) return false
      if (parsed.name.toLowerCase() !== key) return false
      if (want.tier != null && parsed.tier !== want.tier) return false
      return true
    })
}

/** Build trade stats groups for supports (AND/OR across selected supports). */
export async function buildMercenarySupportStatGroups(
  wants: readonly WantSupportFilter[],
  mode: SupportPresenceMode,
): Promise<{ groups: Array<{ type: string; filters: Array<{ id: string }> }>; resolved: number; missing: string[] }> {
  const missing: string[] = []
  const perSupport: Array<Array<{ id: string }>> = []
  for (const want of wants) {
    const ids = (await resolveMercenarySupportStatIdsForWant(want)).map((e) => ({ id: e.id }))
    if (ids.length === 0) {
      missing.push(want.tier != null ? `${want.name} (T${want.tier})` : want.name)
    } else {
      perSupport.push(ids)
    }
  }
  if (perSupport.length === 0) {
    return { groups: [], resolved: 0, missing }
  }
  if (mode === 'any') {
    const seen = new Set<string>()
    const filters: Array<{ id: string }> = []
    for (const group of perSupport) {
      for (const f of group) {
        if (seen.has(f.id)) continue
        seen.add(f.id)
        filters.push(f)
      }
    }
    return { groups: [{ type: 'or', filters }], resolved: filters.length, missing }
  }
  const groups = perSupport.map((filters) => ({
    type: filters.length > 1 ? 'or' : 'and',
    filters,
  }))
  return {
    groups,
    resolved: groups.reduce((n, g) => n + g.filters.length, 0),
    missing,
  }
}

export type MercenaryWarrantCatalog = {
  skills: string[]
  supports: WantSupportFilter[]
}

/** Full merc skill/support lists from the official trade stats payload. */
export async function getMercenaryWarrantCatalog(): Promise<MercenaryWarrantCatalog> {
  await ensureStatsLoaded()
  const entries = getStatEntries()
  const skills = entries
    .filter((e) => e.id.startsWith('mercenary.skill_'))
    .map((e) => e.text)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const supportMap = new Map<string, WantSupportFilter>()
  for (const e of entries) {
    if (!e.id.startsWith('mercenary.support_')) continue
    const parsed = parseTradeSupportText(e.text)
    if (!parsed) continue
    supportMap.set(`${parsed.name.toLowerCase()}::${parsed.tier ?? 'any'}`, parsed)
  }
  const supports = [...supportMap.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    if (byName !== 0) return byName
    return (a.tier ?? 0) - (b.tier ?? 0)
  })
  return { skills, supports }
}

/**
 * Search Mercenary Warrants on the official trade site, fetch listing details
 * (including mercenarySkills), convert prices to chaos, and group by skill package.
 */
export async function scanMercenaryWarrants(
  league: string,
  options: WarrantScanOptions = {},
): Promise<WarrantScanResult> {
  if (getPoeVersion() !== 1) {
    throw new Error('Scalpel Warrants is PoE1-only')
  }

  const limit = Math.min(100, Math.max(10, options.limit ?? 50))
  const onlineOnly = options.onlineOnly ?? false
  const pricedOnly = options.pricedOnly ?? true
  const sort = options.sort ?? 'asc'
  const maxAskDivine =
    options.maxAskDivine === undefined ? DEFAULT_MAX_ASK_DIVINE : options.maxAskDivine
  const excludeJokeCurrencies = options.excludeJokeCurrencies ?? true
  const wantSkills = (options.wantSkills ?? []).map((s) => s.trim()).filter(Boolean)
  const skillMatchMode = options.skillMatchMode ?? 'all'
  const wantSupports = (options.wantSupports ?? [])
    .map((s) => ({ name: s.name.trim(), tier: s.tier ?? null }))
    .filter((s) => s.name)
  const supportPresenceMode = options.supportPresenceMode ?? 'all'
  const supportLinkOrder = options.supportLinkOrder ?? 'ordered'
  const linkSkill = options.linkSkill?.trim() || wantSkills[0] || null

  // Currency → chaos conversion needs a fresh-ish ninja currency table.
  try {
    await refreshPrices(league)
  } catch {
    /* best-effort; unpriced conversion falls back to null chaos */
  }

  const skillStats = await buildMercenarySkillStatGroups(wantSkills, skillMatchMode)
  if (wantSkills.length > 0 && skillStats.resolved === 0) {
    throw new Error(
      `No trade filters found for: ${wantSkills.join(', ')}. Try the exact skill name from a warrant.`,
    )
  }
  if (skillStats.missing.length > 0) {
    throw new Error(`No trade filters found for: ${skillStats.missing.join(', ')}`)
  }

  const supportStats = await buildMercenarySupportStatGroups(wantSupports, supportPresenceMode)
  if (wantSupports.length > 0 && supportStats.resolved === 0) {
    throw new Error(
      `No trade support filters found for: ${supportStats.missing.join(', ')}. Pick a Tiered support from the list.`,
    )
  }
  if (supportStats.missing.length > 0) {
    throw new Error(`No trade support filters found for: ${supportStats.missing.join(', ')}`)
  }

  const divineChaos = getDivineChaosRate()
  const maxAskChaos =
    maxAskDivine != null && divineChaos != null
      ? maxAskDivine * divineChaos
      : maxAskDivine != null
        ? maxAskDivine * (FALLBACK_MAX_ASK_CHAOS / DEFAULT_MAX_ASK_DIVINE)
        : FALLBACK_MAX_ASK_CHAOS

  const urls = getTradeUrls(1)
  const tradeFilters: Record<string, unknown> = {}
  if (pricedOnly) {
    const price: Record<string, unknown> = { min: 1 }
    if (maxAskDivine != null && maxAskDivine > 0) {
      price.max = maxAskDivine
      price.option = 'divine'
    }
    tradeFilters.price = price
  }

  const stats = [
    ...(skillStats.resolved > 0 ? skillStats.groups : []),
    ...(supportStats.resolved > 0 ? supportStats.groups : []),
  ]
  if (stats.length === 0) stats.push({ type: 'and', filters: [] as Array<{ id: string }> })

  const body = JSON.stringify({
    query: {
      status: { option: onlineOnly ? 'online' : 'any' },
      type: 'Mercenary Warrant',
      stats,
      filters: {
        trade_filters: { disabled: false, filters: tradeFilters },
      },
    },
    sort: { price: sort },
  })

  const search = (await fetchJson(urls.search(league), { method: 'POST', body })) as {
    id?: string
    total?: number
    result?: string[]
  }

  const queryId = search.id ?? ''
  const total = search.total ?? 0
  const ids = (search.result ?? []).slice(0, limit)
  const raw = ids.length > 0 ? await fetchBatches(ids, queryId) : []

  const usableOpts: UsableAskOpts = { maxAskChaos, excludeJokeCurrencies }
  let excludedOutliers = 0

  const allListings: WarrantListing[] = raw.map((r) => {
    const skills = parseSkills(r.item?.mercenarySkills)
    const amount = r.listing?.price?.amount
    const currency = r.listing?.price?.currency ?? null
    const chaosValue =
      typeof amount === 'number' && currency ? priceToChaos(amount, currency) : null
    const usableAsk = isUsableAsk(chaosValue, currency, usableOpts)
    if (chaosValue != null && !usableAsk) excludedOutliers++
    const onlineRaw = r.listing?.account?.online
    const online =
      typeof onlineRaw === 'object' && onlineRaw != null
        ? onlineRaw.status === 'online' || Boolean(onlineRaw)
        : Boolean(onlineRaw)
    const levelRaw = propValue(r.item?.properties, 'Mercenary Level')

    return {
      id: r.id ?? '',
      queryId,
      mercenaryName: mercenaryName(r.item?.properties),
      build: propValue(r.item?.properties, 'Build') ?? 'Unknown',
      level: levelRaw ? Number(levelRaw) || null : null,
      skills,
      fingerprint: fingerprintSkills(skills),
      skillKey: skillKey(skills),
      priceAmount: typeof amount === 'number' ? amount : null,
      priceCurrency: currency,
      chaosValue,
      usableAsk,
      instantBuyout: r.listing?.fee != null && r.listing.fee !== '',
      whisper: r.listing?.whisper ?? null,
      account: r.listing?.account?.name ?? null,
      characterName: r.listing?.account?.lastCharacterName ?? null,
      online,
      indexed: r.listing?.indexed ?? null,
      icon: r.item?.icon ?? null,
    }
  })

  // Trade filters can only require support *presence*. Link order is enforced here.
  let excludedLinkMismatches = 0
  const listings =
    wantSupports.length === 0
      ? allListings
      : allListings.filter((row) => {
          const ok = listingMatchesSupportLink(row.skills, wantSupports, {
            presence: supportPresenceMode,
            order: supportLinkOrder,
            linkSkill,
            wantSkills,
          })
          if (!ok) excludedLinkMismatches++
          return ok
        })

  return {
    total,
    fetched: listings.length,
    excludedOutliers,
    queryId,
    league,
    scannedAt: Date.now(),
    divineChaos,
    sort,
    maxAskDivine,
    wantSkills,
    skillMatchMode,
    resolvedSkillFilters: skillStats.resolved,
    wantSupports,
    supportPresenceMode,
    supportLinkOrder,
    linkSkill,
    resolvedSupportFilters: supportStats.resolved,
    excludedLinkMismatches,
    groups: groupListings(listings, 'floor'),
    listings,
    webSearchUrl: queryId
      ? urls.webSearch(league, queryId)
      : `${urls.webSearch(league, '')}`.replace(/\/$/, ''),
  }
}
