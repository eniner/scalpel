import { defaultPoeItem, getItemIcon } from '@scalpelpoe/plugin-sdk'
import type { PriceEntry } from '@scalpelpoe/plugin-sdk'

/** Build name → icon URL from a price snapshot (covers items missing from iconMap). */
export function indexPriceIcons(entries: PriceEntry[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of entries) {
    if (!e.icon) continue
    map.set(e.name, e.icon)
    map.set(e.name.toLowerCase(), e.icon)
  }
  return map
}

export type IconResolveOpts = {
  /** Prefer this base type (e.g. gem trade mapping `type`). */
  baseType?: string | null
  /** Extra lookups from ctx.prices icons. */
  priceIcons?: Map<string, string>
  /** Alternate names to try (priceId title case, unique keys, …). */
  aliases?: string[]
}

/**
 * Resolve a PoE item icon URL using Scalpel's global iconMap (via getItemIcon),
 * then price-feed icons, then simple name heuristics.
 */
export function resolveItemIcon(name: string, opts: IconResolveOpts = {}): string | null {
  if (!name) return null

  const tryNames = [name, ...(opts.aliases ?? [])].filter(Boolean)
  if (opts.baseType) tryNames.push(opts.baseType)

  // Transfigured gems: "Skill of Foo" → also try base "Skill"
  const ofIdx = name.lastIndexOf(' of ')
  if (ofIdx > 0) tryNames.push(name.slice(0, ofIdx))

  for (const n of tryNames) {
    const fromMap = getItemIcon(defaultPoeItem({ name: n, baseType: opts.baseType || n }))
    if (fromMap) return fromMap
  }

  if (opts.priceIcons) {
    for (const n of tryNames) {
      const hit = opts.priceIcons.get(n) ?? opts.priceIcons.get(n.toLowerCase())
      if (hit) return hit
    }
  }

  return null
}
