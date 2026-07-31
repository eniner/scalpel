import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import rowsJson from '../data/betrayal-rows.json'
import {
  BETRAYAL_SCARAB_IDS,
  computeBetrayal,
  type BetrayalMaps,
  type BetrayalRow,
  type BetrayalScarabSel,
  type Safehouse,
} from '../engines/betrayal'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, fmtSignedChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { inputStyle, theme } from '../shared/theme'

const ROWS = rowsJson as BetrayalRow[]

const DEFAULT_MAPS: BetrayalMaps = {
  transportation: 12,
  fortification: 15,
  research: 3.5,
  intervention: 4,
}

export function BetrayalTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [maps, setMaps] = useState<BetrayalMaps>(DEFAULT_MAPS)
  const [timeSec, setTimeSec] = useState(240)
  const [scarabs, setScarabs] = useState<BetrayalScarabSel>({
    betrayal: true,
    reinforcements: false,
    perpetuation: false,
  })
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [scarabPrices, setScarabPrices] = useState<Record<keyof BetrayalScarabSel, number | null>>({
    betrayal: null,
    reinforcements: null,
    perpetuation: null,
  })
  const [drops, setDrops] = useState<Record<string, number>>(() =>
    Object.fromEntries(ROWS.map((r) => [r.id, r.defaultDrop])),
  )
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)
      const next: Record<string, number | null> = {}
      for (const row of ROWS) {
        if (row.kind === 'unique' && row.uniqueName) {
          next[row.id] = chaosForName(byName, row.uniqueName)
        } else if (row.currencyId) {
          next[row.id] = chaosForId(byName, row.currencyId) ?? chaosForName(byName, row.name)
        } else {
          next[row.id] = chaosForName(byName, row.name)
        }
      }
      setPrices(next)
      setScarabPrices({
        betrayal: chaosForId(byName, BETRAYAL_SCARAB_IDS.betrayal),
        reinforcements: chaosForId(byName, BETRAYAL_SCARAB_IDS.reinforcements),
        perpetuation: chaosForId(byName, BETRAYAL_SCARAB_IDS.perpetuation),
      })
      setStatus(`Prices · ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const result = useMemo(
    () => computeBetrayal(ROWS, prices, drops, maps, scarabs, scarabPrices, timeSec),
    [prices, drops, maps, scarabs, scarabPrices, timeSec],
  )

  const setMap = (key: Safehouse, v: number) => {
    setMaps((prev) => ({ ...prev, [key]: v }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="betrayal"
        title="Betrayal EV"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Expected value per map of running Betrayal safehouses. Defaults assume 3-star leaders.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        {(['transportation', 'fortification', 'research', 'intervention'] as Safehouse[]).map((k) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }}>
            Maps / {k.slice(0, 4)}
            <input
              style={inputStyle}
              type="number"
              step="0.5"
              value={maps[k]}
              onChange={(e) => setMap(k, Number(e.target.value) || 1)}
            />
          </label>
        ))}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }}>
          Sec / Map
          <input
            style={inputStyle}
            type="number"
            value={timeSec}
            onChange={(e) => setTimeSec(Number(e.target.value) || 240)}
          />
        </label>
        {(Object.keys(scarabs) as (keyof BetrayalScarabSel)[]).map((key) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={scarabs[key]}
              onChange={(e) => setScarabs((s) => ({ ...s, [key]: e.target.checked }))}
            />
            {key}{' '}
            <span style={{ color: theme.dim }}>
              {scarabPrices[key] != null ? fmtChaos(scarabPrices[key], cpd) : '—'}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="GROSS EV / MAP" value={fmtChaos(result.grossEvPerMap, cpd)} />
        <Stat label="SCARAB COST / MAP" value={fmtSignedChaos(-result.scarabCostPerMap, cpd)} color={theme.red} />
        <Stat label="NET EV / MAP" value={fmtSignedChaos(result.netEvPerMap, cpd)} color={theme.green} />
        <Stat label="NET EV / HOUR" value={fmtSignedChaos(result.netEvPerHour, cpd)} color={theme.green} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: theme.dim, textAlign: 'left' }}>
              <th style={th}>ITEM</th>
              <th style={th}>PRICE</th>
              <th style={th}>DROP %</th>
              <th style={th}>EV / SH</th>
              <th style={th}>EV / MAP</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(({ row, price, dropPct, evPerSafehouse, evPerMap }) => (
              <tr key={row.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                <td style={td}>
                  <ItemName
                    name={row.name}
                    opts={{
                      priceIcons,
                      aliases: [
                        ...(row.uniqueName ? [row.uniqueName] : []),
                        ...(row.currencyId ? [idToName(row.currencyId)] : []),
                      ],
                    }}
                  >
                    {row.name}
                    {row.safehouse ? (
                      <span style={{ color: theme.dim }}> ({row.safehouse})</span>
                    ) : null}
                  </ItemName>
                </td>
                <td style={td}>
                  <input
                    style={{ ...inputStyle, width: 80 }}
                    value={price != null ? String(Math.round(price * 100) / 100) : ''}
                    placeholder="—"
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setPrices((p) => ({ ...p, [row.id]: Number.isFinite(v) ? v : null }))
                    }}
                  />
                </td>
                <td style={td}>
                  <input
                    style={{ ...inputStyle, width: 56 }}
                    type="number"
                    value={dropPct}
                    onChange={(e) =>
                      setDrops((d) => ({ ...d, [row.id]: Number(e.target.value) || 0 }))
                    }
                  />
                </td>
                <td style={{ ...td, color: theme.purple }}>{fmtChaos(evPerSafehouse, cpd)}</td>
                <td style={{ ...td, color: theme.green }}>{fmtChaos(evPerMap, cpd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: 9, color: theme.dim, letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: color ?? theme.text }}>{value}</div>
    </div>
  )
}

const th: CSSProperties = { padding: '6px 8px', fontWeight: 500, fontSize: 10 }
const td: CSSProperties = { padding: '5px 8px' }
