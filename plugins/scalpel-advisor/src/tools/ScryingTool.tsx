import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import scryingRefJson from '../data/scrying-ref.json'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { floorToChaos, ledgerGet, leagueDataPath, type Floor } from '../shared/ledger'
import { divineRate, fmtChaos, indexPrices, mirrorRateDiv } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { btnStyle, inputStyle, theme } from '../shared/theme'
import { buildNameTradeUrl, buildTypeTradeUrl } from '../shared/tradeUrl'

type ScryingArea = {
  mapArea: string
  floors: Floor
  listings: number
  volume24h: number
  tradeTypeId: string | null
  recentSales?: unknown
}

type ScryingData = {
  league: string
  generatedAt: string
  tradeDiscriminator: string
  totalListings: number
  areas: ScryingArea[]
}

const REF = scryingRefJson as unknown as ScryingData

type SortKey = 'mapArea' | 'price' | 'listings' | 'volume24h'
type SortDir = 1 | -1

const DEFAULT_DIR: Record<SortKey, SortDir> = { mapArea: 1, price: 1, listings: -1, volume24h: -1 }

function scryingTradeUrl(area: ScryingArea, tradeDiscriminator: string, league: string): string {
  if (area.tradeTypeId) {
    return buildTypeTradeUrl(league, { option: area.tradeTypeId, discriminator: tradeDiscriminator })
  }
  return buildNameTradeUrl(league, 'Scrying Orb')
}

export function ScryingTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [data, setData] = useState<ScryingData>(REF)
  const [cpd, setCpd] = useState(180)
  const [mirrorDiv, setMirrorDiv] = useState(380)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'price', dir: 1 })

  const league = ctx.getLeague()

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(divineRate(byName))
      setMirrorDiv(mirrorRateDiv(byName))

      try {
        const live = await ledgerGet<ScryingData>(leagueDataPath(league, 'scrying-orbs.json'))
        setData(live)
        setStatus(`Live · ${league} · ${live.areas.length} areas`)
      } catch {
        setData(REF)
        setStatus(`Bundled snapshot · ${league} (live fetch failed)`)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx, league])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows = useMemo(
    () =>
      data.areas.map((area) => ({
        area,
        price: floorToChaos(area.floors, cpd, mirrorDiv),
      })),
    [data, cpd, mirrorDiv],
  )

  const summary = useMemo(() => {
    let listings = 0
    let sold24h = 0
    let cheapest: (typeof rows)[number] | null = null
    let priciest: (typeof rows)[number] | null = null
    for (const r of rows) {
      listings += r.area.listings
      sold24h += r.area.volume24h
      if (r.price != null) {
        if (!cheapest || r.price < (cheapest.price ?? Infinity)) cheapest = r
        if (!priciest || r.price > (priciest.price ?? -Infinity)) priciest = r
      }
    }
    return { listings, sold24h, cheapest, priciest, areas: rows.length }
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q ? rows.filter((r) => r.area.mapArea.toLowerCase().includes(q)) : rows

    const dir = sort.dir
    list = [...list].sort((a, b) => {
      let diff = 0
      switch (sort.key) {
        case 'mapArea':
          diff = a.area.mapArea.localeCompare(b.area.mapArea)
          break
        case 'listings':
          diff = a.area.listings - b.area.listings
          break
        case 'volume24h':
          diff = a.area.volume24h - b.area.volume24h
          break
        case 'price':
        default:
          diff = (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
          break
      }
      return diff * dir
    })
    // Unpriced rows always sink to the bottom regardless of sort direction.
    list.sort((a, b) => (a.price == null ? 1 : 0) - (b.price == null ? 1 : 0))
    return list
  }, [rows, search, sort])

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: (prev.dir * -1) as SortDir } : { key, dir: DEFAULT_DIR[key] }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="scrying"
        title="Scrying Orb Market"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
        refreshLabel="Refresh"
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        <ItemName name="Scrying Orb" opts={{ priceIcons }} size={18}>
          Scrying Orb
        </ItemName>{' '}
        prices by map area — cheapest orbs reveal item mods for the least chaos.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        <Stat label="ACTIVE LISTINGS" value={String(summary.listings)} />
        <Stat label="AREAS TRACKED" value={String(summary.areas)} />
        <Stat
          label="CHEAPEST"
          value={summary.cheapest ? `${summary.cheapest.area.mapArea} · ${fmtChaos(summary.cheapest.price, cpd)}` : '—'}
          color={theme.green}
        />
        <Stat
          label="PRICIEST"
          value={summary.priciest ? `${summary.priciest.area.mapArea} · ${fmtChaos(summary.priciest.price, cpd)}` : '—'}
          color={theme.red}
        />
        <Stat label="SOLD 24H" value={String(summary.sold24h)} color={theme.blue} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }}>
          Search Map Area
          <input
            style={{ ...inputStyle, width: 180 }}
            type="text"
            placeholder="e.g. Strand"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span style={{ color: theme.dim, fontSize: 11 }}>
          {filtered.length} / {rows.length} areas
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: theme.dim, textAlign: 'left', position: 'sticky', top: 0, background: theme.panel }}>
              <Th label="MAP AREA" sortKey="mapArea" sort={sort} onClick={toggleSort} />
              <Th label="PRICE" sortKey="price" sort={sort} onClick={toggleSort} />
              <Th label="LISTINGS" sortKey="listings" sort={sort} onClick={toggleSort} />
              <Th label="SOLD 24H" sortKey="volume24h" sort={sort} onClick={toggleSort} />
              <th style={th}>TRADE</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ area, price }) => (
              <tr key={area.mapArea} style={{ borderTop: `1px solid ${theme.border}`, opacity: price == null ? 0.5 : 1 }}>
                <td style={td}>{area.mapArea}</td>
                <td style={{ ...td, color: theme.green }}>{fmtChaos(price, cpd)}</td>
                <td style={td}>{area.listings}</td>
                <td style={td}>{area.volume24h}</td>
                <td style={td}>
                  <button
                    type="button"
                    style={{ ...btnStyle, padding: '2px 8px', fontSize: 10 }}
                    onClick={() => ctx.openExternal(scryingTradeUrl(area, data.tradeDiscriminator, league))}
                  >
                    Trade →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({
  label,
  sortKey,
  sort,
  onClick,
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: SortDir }
  onClick: (key: SortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={() => onClick(sortKey)}>
      {label}
      {active ? <span style={{ color: theme.accent }}> {sort.dir === 1 ? '▲' : '▼'}</span> : null}
    </th>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: theme.dim, letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color ?? theme.text }}>{value}</div>
    </div>
  )
}

const th: CSSProperties = { padding: '6px 8px', fontWeight: 500, fontSize: 10 }
const td: CSSProperties = { padding: '5px 8px' }
