import type { PriceEntry } from '@scalpelpoe/plugin-sdk'

export function indexPrices(entries: PriceEntry[]): Map<string, PriceEntry> {
  const map = new Map<string, PriceEntry>()
  for (const e of entries) {
    map.set(e.name, e)
    map.set(e.name.toLowerCase(), e)
  }
  return map
}

export function divineRate(byName: Map<string, PriceEntry>): number {
  const d = byName.get('Divine Orb') ?? byName.get('divine orb')
  return d && d.chaosValue > 0 ? d.chaosValue : 180
}

export function mirrorRateDiv(byName: Map<string, PriceEntry>): number {
  const m = byName.get('Mirror of Kalandra') ?? byName.get('mirror of kalandra')
  const cpd = divineRate(byName)
  if (!m || !(m.chaosValue > 0) || !(cpd > 0)) return 380
  return m.chaosValue / cpd
}

/** Convert kebab currency id to Title Case name. */
export function idToName(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function chaosForName(byName: Map<string, PriceEntry>, name: string): number | null {
  const hit = byName.get(name) ?? byName.get(name.toLowerCase())
  if (!hit || !Number.isFinite(hit.chaosValue)) return null
  return hit.chaosValue
}

export function chaosForId(byName: Map<string, PriceEntry>, id: string): number | null {
  return chaosForName(byName, idToName(id))
}

export function fmtChaos(n: number | null | undefined, cpd = 180): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= cpd) {
    const d = abs / cpd
    return `${sign}${d >= 10 ? d.toFixed(1) : d.toFixed(2)}d`
  }
  if (abs >= 100) return `${sign}${abs.toFixed(0)}c`
  if (abs >= 10) return `${sign}${abs.toFixed(1)}c`
  return `${sign}${abs.toFixed(2)}c`
}

export function fmtSignedChaos(n: number | null | undefined, cpd = 180): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const body = fmtChaos(Math.abs(n), cpd)
  if (n > 0) return `+${body}`
  if (n < 0) return `-${body.replace(/^-/, '')}`
  return body
}

export function parseUserPrice(input: string, cpd: number, mirrorDiv = 380): number | null {
  const match = input.trim().match(/^([0-9.]+)\s*(c|d|m)?$/i)
  if (!match) return null
  const value = parseFloat(match[1])
  if (!Number.isFinite(value)) return null
  const unit = (match[2] || 'c').toLowerCase()
  if (unit === 'd') return value * cpd
  if (unit === 'm') return value * cpd * mirrorDiv
  return value
}
