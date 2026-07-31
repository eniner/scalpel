/** Shared pathofexile.com/trade search URL builders (gem + name search variants). */

export type TypeFilter = string | { option: string; discriminator?: string }

function buildUrl(league: string, query: Record<string, unknown>): string {
  const searchQuery = { query: { status: { option: 'online' }, stats: [{ type: 'and', filters: [] }], ...query }, sort: { price: 'asc' } }
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(searchQuery))}`
}

export function buildTypeTradeUrl(league: string, type: TypeFilter): string {
  return buildUrl(league, { type })
}

export function buildNameTradeUrl(league: string, name: string): string {
  return buildUrl(league, { name })
}

export type GemTradeMapping = {
  baseToVaal: Record<string, string>
  trade: Record<string, { disc: string | null; type: string }>
}

export function gemTradeUrl(gemName: string, mapping: GemTradeMapping, league: string): string {
  const entry = mapping.trade[gemName]
  const type = entry?.type ?? gemName
  const filter: TypeFilter = entry?.disc ? { option: type, discriminator: entry.disc } : type
  return buildTypeTradeUrl(league, filter)
}
