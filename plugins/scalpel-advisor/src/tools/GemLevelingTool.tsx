import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import gemLevelingRefJson from '../data/gem-leveling-ref.json'
import gemTradeMappingJson from '../data/gem-trade-mapping.json'
import { computeRows, type GemComputedRow, type GemLevelingData, type GemType } from '../engines/gemLeveling'
import { ledgerGet, leagueDataPath, floorToChaos } from '../shared/ledger'
import { chaosForName, fmtChaos, fmtSignedChaos, indexPrices } from '../shared/prices'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { ToolHeader } from '../shared/ToolChrome'
import { inputStyle, theme } from '../shared/theme'
import { gemTradeUrl, type GemTradeMapping } from '../shared/tradeUrl'

const REF = gemLevelingRefJson as unknown as GemLevelingData
const TRADE_MAPPING = gemTradeMappingJson as unknown as GemTradeMapping

type TypeFilter = 'all' | GemType

const TYPE_COLOR: Record<GemType, string> = {
  skill: theme.blue,
  support: theme.purple,
  exceptional: theme.accent,
}

const REC_COLOR: Record<GemComputedRow['recommend'], string> = {
  '0q': theme.blue,
  '20q': theme.green,
  skip: theme.dim,
}

type SortKey = 'name' | 'buy' | 'low0q' | 'high20q' | 'profit'
type SortDir = 1 | -1

export function GemLevelingTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [data, setData] = useState<GemLevelingData>(REF)
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const [gcpPrice, setGcpPrice] = useState(() => floorToChaos(REF.gcpFloors, 180) ?? 3)
  const [gcpsNeeded, setGcpsNeeded] = useState(20)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [vendorOnly, setVendorOnly] = useState(false)
  const [minListings, setMinListings] = useState(3)
  const [minVolume, setMinVolume] = useState(10)
  const [belowThresholdLast, setBelowThresholdLast] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'profit', dir: -1 })

  const league = ctx.getLeague()

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      const nextCpd = chaosForName(byName, 'Divine Orb') ?? 180
      setCpd(nextCpd)

      try {
        const live = await ledgerGet<GemLevelingData>(leagueDataPath(league, 'gem-leveling-advisor.json'))
        setData(live)
        setGcpPrice((prev) => floorToChaos(live.gcpFloors, nextCpd) ?? prev)
        setStatus(`Live · ${league} · ${live.gems.length} gems`)
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
    () => computeRows(data, { gcpPrice, gcpsNeeded, cpd, minListings, minVolume }),
    [data, gcpPrice, gcpsNeeded, cpd, minListings, minVolume],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows
    if (typeFilter !== 'all') list = list.filter((r) => r.gem.type === typeFilter)
    if (vendorOnly) list = list.filter((r) => !r.gem.hasBuyCost)
    if (q) list = list.filter((r) => r.gem.name.toLowerCase().includes(q))

    const dir = sort.dir
    const sorted = [...list].sort((a, b) => {
      let diff = 0
      switch (sort.key) {
        case 'name':
          diff = a.gem.name.localeCompare(b.gem.name)
          break
        case 'buy':
          diff = (a.buy ?? -1) - (b.buy ?? -1)
          break
        case 'low0q':
          diff = (a.low0q ?? -1) - (b.low0q ?? -1)
          break
        case 'high20q':
          diff = (a.high20q ?? -1) - (b.high20q ?? -1)
          break
        case 'profit':
        default:
          diff = (a.bestNormProfit ?? Number.NEGATIVE_INFINITY) - (b.bestNormProfit ?? Number.NEGATIVE_INFINITY)
          break
      }
      return diff * dir
    })
    if (belowThresholdLast) {
      sorted.sort((a, b) => (a.belowThreshold === b.belowThreshold ? 0 : a.belowThreshold ? 1 : -1))
    }
    return sorted
  }, [rows, typeFilter, vendorOnly, search, sort, belowThresholdLast])

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: -1 }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="gem-leveling"
        title="Gem Leveling Advisor"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
        refreshLabel="Refresh"
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Buy a gem, level to 20 (optionally 20% quality), and resell. Profit is normalized per unit of gem XP so
        exceptional gems (1→3) compare fairly against normal gems (1→20).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={lab}>
          GCP Price
          <input
            style={inputStyle}
            type="number"
            step="0.1"
            value={gcpPrice}
            onChange={(e) => setGcpPrice(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          GCPs Needed
          <input
            style={inputStyle}
            type="number"
            value={gcpsNeeded}
            onChange={(e) => setGcpsNeeded(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          Type
          <select
            style={{ ...inputStyle, width: 100 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          >
            <option value="all">All</option>
            <option value="skill">Skill</option>
            <option value="support">Support</option>
            <option value="exceptional">Exceptional</option>
          </select>
        </label>
        <label style={lab}>
          Min Listings
          <input
            style={inputStyle}
            type="number"
            value={minListings}
            onChange={(e) => setMinListings(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          Min Volume
          <input
            style={inputStyle}
            type="number"
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          Search
          <input
            style={{ ...inputStyle, width: 140 }}
            type="text"
            placeholder="Gem name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label style={{ ...checkLab }}>
          <input type="checkbox" checked={vendorOnly} onChange={(e) => setVendorOnly(e.target.checked)} />
          Vendor only
        </label>
        <label style={{ ...checkLab }}>
          <input
            type="checkbox"
            checked={belowThresholdLast}
            onChange={(e) => setBelowThresholdLast(e.target.checked)}
          />
          Below-threshold last
        </label>
        <span style={{ color: theme.dim, fontSize: 11 }}>
          {filtered.length} / {rows.length} gems
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: theme.dim, textAlign: 'left', position: 'sticky', top: 0, background: theme.panel }}>
              <Th label="GEM" onClick={() => toggleSort('name')} active={sort.key === 'name'} dir={sort.dir} />
              <th style={th}>TYPE</th>
              <Th label="BUY" onClick={() => toggleSort('buy')} active={sort.key === 'buy'} dir={sort.dir} />
              <Th label="0Q LOW" onClick={() => toggleSort('low0q')} active={sort.key === 'low0q'} dir={sort.dir} />
              <th style={th}>LIST/VOL</th>
              <Th
                label="20Q LOW"
                onClick={() => toggleSort('high20q')}
                active={sort.key === 'high20q'}
                dir={sort.dir}
              />
              <th style={th}>LIST/VOL</th>
              <Th label="NORM PROFIT" onClick={() => toggleSort('profit')} active={sort.key === 'profit'} dir={sort.dir} />
              <th style={th}>REC</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.gem.name}
                style={{
                  borderTop: `1px solid ${theme.border}`,
                  opacity: r.belowThreshold ? 0.5 : 1,
                }}
              >
                <td style={td}>
                  <ItemName
                    name={r.gem.name}
                    size={22}
                    opts={{
                      baseType: TRADE_MAPPING.trade[r.gem.name]?.type,
                      priceIcons,
                    }}
                  >
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        ctx.openExternal(gemTradeUrl(r.gem.name, TRADE_MAPPING, league))
                      }}
                      style={{ color: theme.text, textDecoration: 'none' }}
                      title="Open trade search"
                    >
                      {r.gem.name}
                    </a>
                  </ItemName>
                </td>
                <td style={td}>
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.03em',
                      color: TYPE_COLOR[r.gem.type],
                      border: `1px solid ${TYPE_COLOR[r.gem.type]}`,
                      borderRadius: 3,
                      padding: '1px 5px',
                    }}
                  >
                    {r.gem.type.toUpperCase()}
                  </span>
                </td>
                <td style={td}>{r.gem.hasBuyCost ? fmtChaos(r.buy, cpd) : 'free'}</td>
                <td style={td}>{fmtChaos(r.low0q, cpd)}</td>
                <td style={{ ...td, color: theme.dim, fontSize: 10 }}>
                  {r.lowListings} / {r.lowVolume}
                </td>
                <td style={td}>{fmtChaos(r.high20q, cpd)}</td>
                <td style={{ ...td, color: theme.dim, fontSize: 10 }}>
                  {r.highListings} / {r.highVolume}
                </td>
                <td style={{ ...td, color: r.bestNormProfit != null && r.bestNormProfit > 0 ? theme.green : theme.red }}>
                  {fmtSignedChaos(r.bestNormProfit, cpd)}
                </td>
                <td style={{ ...td, color: REC_COLOR[r.recommend], fontWeight: 600 }}>{r.recommend.toUpperCase()}</td>
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
  onClick,
  active,
  dir,
}: {
  label: string
  onClick: () => void
  active: boolean
  dir: SortDir
}) {
  return (
    <th style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={onClick}>
      {label}
      {active ? <span style={{ color: theme.accent }}> {dir === 1 ? '▲' : '▼'}</span> : null}
    </th>
  )
}

const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }
const checkLab: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.text }
const th: CSSProperties = { padding: '6px 8px', fontWeight: 500, fontSize: 10 }
const td: CSSProperties = { padding: '5px 8px' }
