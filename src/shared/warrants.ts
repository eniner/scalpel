/** Mercenary Warrant trade scanner — live listings + skill-link fingerprints. */

export type WarrantSupport = {
  hash: number
  name: string
  tier?: number
}

export type WarrantSkill = {
  hash: number
  name: string
  icon?: string
  supports: WarrantSupport[]
}

export type WantSupportFilter = {
  /** Support name as on the warrant / trade site, e.g. "Greater Pierce". */
  name: string
  /** Required tier (1–3). Omit / null = any tier. */
  tier?: number | null
}

export type SupportPresenceMode = 'all' | 'any'
/** How selected supports must appear on the focused skill's link. */
export type SupportLinkOrder = 'ignore' | 'ordered' | 'exact'

export type WarrantListing = {
  id: string
  queryId: string
  mercenaryName: string
  build: string
  level: number | null
  skills: WarrantSkill[]
  /** Exact skill+support link order fingerprint (order preserved). */
  fingerprint: string
  /** Skill names only, sorted — for coarse filtering. */
  skillKey: string
  priceAmount: number | null
  priceCurrency: string | null
  chaosValue: number | null
  /** True when chaosValue is within the scan's usable ask band (not joke/mirror). */
  usableAsk: boolean
  /** Present when the listing supports instant buyout / Travel to Hideout. */
  instantBuyout: boolean
  /** Official trade whisper template from the fetch payload (may be absent). */
  whisper: string | null
  account: string | null
  characterName: string | null
  online: boolean
  indexed: string | null
  icon: string | null
}

export type WarrantSkillGroup = {
  fingerprint: string
  skillKey: string
  build: string
  count: number
  /** Listings that survived outlier filtering. */
  usableCount: number
  /** Cheapest usable ask (market floor for this package). */
  minChaos: number | null
  /** Median of usable asks only. */
  medianChaos: number | null
  maxChaos: number | null
  /** Cheapest usable listing (falls back to cheapest overall). */
  sample: WarrantListing
  listings: WarrantListing[]
}

export type WarrantScanResult = {
  total: number
  fetched: number
  /** Listings dropped from ranking stats (mirrors / over-cap asks). */
  excludedOutliers: number
  queryId: string
  league: string
  scannedAt: number
  /** Chaos per divine from poe.ninja at scan time (for UI formatting). */
  divineChaos: number | null
  sort: 'asc' | 'desc'
  /** Trade-side max ask in divine, when applied. */
  maxAskDivine: number | null
  /** Skills requested for this scan (sent to trade when resolvable). */
  wantSkills: string[]
  skillMatchMode: 'all' | 'any'
  /** How many of wantSkills resolved to a trade mercenary.skill_* filter. */
  resolvedSkillFilters: number
  wantSupports: WantSupportFilter[]
  supportPresenceMode: SupportPresenceMode
  supportLinkOrder: SupportLinkOrder
  /** Skill whose link is checked for support order (defaults to first wantSkill). */
  linkSkill: string | null
  resolvedSupportFilters: number
  /** Listings dropped client-side for failing link-order / support presence. */
  excludedLinkMismatches: number
  groups: WarrantSkillGroup[]
  listings: WarrantListing[]
  webSearchUrl: string
}

/** Preserve skill order and support link order — that is the marketable package. */
export function fingerprintSkills(skills: WarrantSkill[]): string {
  return skills
    .map((s) => {
      const links = s.supports.map((sup) => (sup.tier != null ? `${sup.name}:t${sup.tier}` : sup.name)).join('+')
      return links ? `${s.name}[${links}]` : s.name
    })
    .join(' | ')
}

export function skillKey(skills: WarrantSkill[]): string {
  return [...skills.map((s) => s.name)].sort((a, b) => a.localeCompare(b)).join(', ')
}

export function supportKey(s: WantSupportFilter): string {
  return s.tier != null ? `${s.name}::${s.tier}` : s.name
}

export function formatSupportLabel(s: WantSupportFilter): string {
  return s.tier != null ? `${s.name} (T${s.tier})` : s.name
}

/** Parse trade catalog text like "Greater Pierce (Tier 3)". */
export function parseTradeSupportText(text: string): WantSupportFilter | null {
  const m = text.trim().match(/^(.+?)\s*\(Tier\s*(\d+)\)\s*$/i)
  if (m) return { name: m[1].trim(), tier: Number(m[2]) }
  const t = text.trim()
  return t ? { name: t, tier: null } : null
}

export function supportMatches(
  have: { name: string; tier?: number },
  want: WantSupportFilter,
): boolean {
  if (have.name.toLowerCase() !== want.name.toLowerCase()) return false
  if (want.tier == null) return true
  return have.tier === want.tier
}

/**
 * Check supports on one skill link.
 * - ignore: all wanted supports present somewhere on the link (order ignored)
 * - ordered: want is an ordered subsequence of the link
 * - exact: link supports equal want (same length + order)
 */
export function matchSupportLinkOrder(
  linked: ReadonlyArray<{ name: string; tier?: number }>,
  want: readonly WantSupportFilter[],
  order: SupportLinkOrder,
): boolean {
  if (want.length === 0) return true
  if (order === 'ignore') {
    return want.every((w) => linked.some((h) => supportMatches(h, w)))
  }
  if (order === 'exact') {
    if (linked.length !== want.length) return false
    return want.every((w, i) => supportMatches(linked[i], w))
  }
  let i = 0
  for (const h of linked) {
    if (i < want.length && supportMatches(h, want[i])) i++
  }
  return i === want.length
}

/** Find the skill row to apply support-link checks against. */
export function findLinkSkill(
  skills: readonly WarrantSkill[],
  linkSkill: string | null | undefined,
  wantSkills: readonly string[],
): WarrantSkill | null {
  const candidates = [linkSkill, ...wantSkills].filter(Boolean) as string[]
  for (const name of candidates) {
    const key = name.toLowerCase()
    const hit =
      skills.find((s) => s.name.toLowerCase() === key) ??
      skills.find((s) => s.name.toLowerCase().startsWith(`${key} of `))
    if (hit) return hit
  }
  return skills[0] ?? null
}

export function listingMatchesSupportLink(
  skills: readonly WarrantSkill[],
  wantSupports: readonly WantSupportFilter[],
  opts: {
    presence: SupportPresenceMode
    order: SupportLinkOrder
    linkSkill?: string | null
    wantSkills?: readonly string[]
  },
): boolean {
  if (wantSupports.length === 0) return true
  const focus = findLinkSkill(skills, opts.linkSkill, opts.wantSkills ?? [])
  if (!focus) return false

  if (opts.order === 'ignore' && opts.presence === 'any') {
    return wantSupports.some((w) => focus.supports.some((h) => supportMatches(h, w)))
  }
  if (opts.order === 'ignore' && opts.presence === 'all') {
    return matchSupportLinkOrder(focus.supports, wantSupports, 'ignore')
  }
  return matchSupportLinkOrder(focus.supports, wantSupports, opts.order)
}
