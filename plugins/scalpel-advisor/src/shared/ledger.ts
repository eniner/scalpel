/** Fetch Perandus Ledger static snapshots (xddbsns.com CDN). */
const LEDGER_BASE = 'https://xddbsns.com'

export type Floor = {
  chaos?: number | null
  divine?: number | null
  mirror?: number | null
  exalted?: number | null
  gcp?: number | null
}

export function floorToChaos(floor: Floor | null | undefined, cpd: number, mirrorDiv = 380): number | null {
  if (!floor) return null
  const candidates: number[] = []
  if (floor.chaos != null) candidates.push(floor.chaos)
  if (floor.divine != null) candidates.push(floor.divine * cpd)
  if (floor.mirror != null) candidates.push(floor.mirror * cpd * mirrorDiv)
  if (floor.gcp != null) candidates.push(floor.gcp) // treat as chaos-equivalent listing unit rarely used
  if (!candidates.length) return null
  return Math.min(...candidates)
}

export async function ledgerGet<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${LEDGER_BASE}${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Ledger fetch ${res.status}: ${path}`)
  return (await res.json()) as T
}

export function leagueDataPath(league: string, file: string): string {
  const id = league.toLowerCase().replace(/\s+/g, '-')
  return `/data/${id}/${file}`
}
