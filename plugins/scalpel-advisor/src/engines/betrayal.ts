export type Safehouse = 'transportation' | 'fortification' | 'research' | 'intervention'

export type BetrayalRow = {
  id: string
  name: string
  kind: 'currency' | 'allflame' | 'unique'
  currencyId?: string
  uniqueName?: string
  safehouse?: Safehouse
  defaultDrop: number
}

export type BetrayalMaps = Record<Safehouse, number>

export type BetrayalScarabSel = {
  betrayal: boolean
  reinforcements: boolean
  perpetuation: boolean
}

export type BetrayalRowResult = {
  row: BetrayalRow
  price: number | null
  dropPct: number
  evPerSafehouse: number | null
  evPerMap: number | null
}

export const BETRAYAL_SCARAB_IDS = {
  betrayal: 'betrayal-scarab',
  reinforcements: 'betrayal-scarab-of-reinforcements',
  perpetuation: 'betrayal-scarab-of-perpetuation',
} as const

export function computeBetrayal(
  rows: BetrayalRow[],
  prices: Record<string, number | null>,
  drops: Record<string, number>,
  maps: BetrayalMaps,
  scarabs: BetrayalScarabSel,
  scarabPrices: Record<keyof BetrayalScarabSel, number | null>,
  timePerMapSec: number,
): {
  rows: BetrayalRowResult[]
  grossEvPerMap: number
  scarabCostPerMap: number
  netEvPerMap: number
  netEvPerHour: number
  totalSafehousesPerMap: number
} {
  const mapsT = maps.transportation > 0 ? maps.transportation : 1
  const mapsF = maps.fortification > 0 ? maps.fortification : 1
  const mapsR = maps.research > 0 ? maps.research : 1
  const mapsI = maps.intervention > 0 ? maps.intervention : 1
  const totalSafehousesPerMap = 1 / mapsT + 1 / mapsF + 1 / mapsR + 1 / mapsI

  const shareFor = (safehouse: Safehouse) => {
    const sh =
      safehouse === 'transportation'
        ? 1 / mapsT
        : safehouse === 'fortification'
          ? 1 / mapsF
          : safehouse === 'research'
            ? 1 / mapsR
            : 1 / mapsI
    return sh / totalSafehousesPerMap
  }

  let grossEvPerMap = 0
  const results: BetrayalRowResult[] = rows.map((row) => {
    const price = prices[row.id] ?? null
    const dropPct = drops[row.id] ?? row.defaultDrop
    let evPerSafehouse: number | null = null
    if (price != null && Number.isFinite(price)) {
      const baseEv = (dropPct / 100) * price
      evPerSafehouse =
        row.kind === 'unique' && row.safehouse ? baseEv * shareFor(row.safehouse) : baseEv
    }
    const evPerMap = evPerSafehouse != null ? evPerSafehouse * totalSafehousesPerMap : null
    if (evPerMap != null) grossEvPerMap += evPerMap
    return { row, price, dropPct, evPerSafehouse, evPerMap }
  })

  let scarabCostPerMap = 0
  for (const key of Object.keys(scarabs) as (keyof BetrayalScarabSel)[]) {
    if (scarabs[key]) {
      const p = scarabPrices[key]
      if (p != null) scarabCostPerMap += p
    }
  }

  const netEvPerMap = grossEvPerMap - scarabCostPerMap
  const mapsPerHour = timePerMapSec > 0 ? 3600 / timePerMapSec : 0
  const netEvPerHour = netEvPerMap * mapsPerHour

  return {
    rows: results,
    grossEvPerMap,
    scarabCostPerMap,
    netEvPerMap,
    netEvPerHour,
    totalSafehousesPerMap,
  }
}
