import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import dataJson from '../data/nightmare-bosses.json'
import { avgFragments, computeNightmareBoss, type NightmareBoss } from '../engines/nightmare'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, fmtSignedChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { inputStyle, theme } from '../shared/theme'

const DATA = dataJson as {
  bosses: NightmareBoss[]
  fragmentNames: Record<string, string>
}

export function NightmareTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [mapCost, setMapCost] = useState(33)
  const [iiq, setIiq] = useState(200)
  const [selectedId, setSelectedId] = useState(DATA.bosses[0]?.id ?? 'ziggurat')
  const [times, setTimes] = useState<Record<string, number>>(() =>
    Object.fromEntries(DATA.bosses.map((b) => [b.id, Math.round(b.defaultTpm * 60)])),
  )
  const [fragPrices, setFragPrices] = useState<Record<string, number>>({})
  const [uniquePrices, setUniquePrices] = useState<Record<string, number>>({})
  const [gemPrices, setGemPrices] = useState<Record<string, number>>({})
  const [rates, setRates] = useState<Record<string, { unique: number; gem: number }>>(() =>
    Object.fromEntries(DATA.bosses.map((b) => [b.id, { unique: b.unique.rate, gem: b.gem.rate }])),
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
      const div = chaosForName(byName, 'Divine Orb') ?? 180
      setCpd(div)

      const frags: Record<string, number> = {}
      for (const [id, name] of Object.entries(DATA.fragmentNames)) {
        frags[id] = chaosForName(byName, name) ?? chaosForId(byName, id) ?? 0
      }
      setFragPrices(frags)

      const uniques: Record<string, number> = {}
      const gems: Record<string, number> = {}
      for (const b of DATA.bosses) {
        const uName = b.unique.name.replace(/^Unid\s+/i, '')
        uniques[b.id] = chaosForName(byName, b.unique.name) ?? chaosForName(byName, uName) ?? 0
        gems[b.id] = chaosForName(byName, b.gem.name) ?? 0
      }
      setUniquePrices(uniques)
      setGemPrices(gems)

      // Prefer a cheap T16 map as default cost if available
      const mapHit =
        chaosForName(byName, 'Cemetery Map') ??
        chaosForName(byName, 'Strand Map') ??
        chaosForName(byName, 'Jungle Valley Map')
      if (mapHit != null) setMapCost(Math.round(mapHit * 10) / 10)

      setStatus(`Prices · ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const avgFrags = avgFragments(iiq)

  const ranked = useMemo(() => {
    return DATA.bosses
      .map((boss) =>
        computeNightmareBoss({
          boss,
          fragmentNames: DATA.fragmentNames,
          fragmentPrices: fragPrices,
          uniquePrice: uniquePrices[boss.id] ?? 0,
          gemPrice: gemPrices[boss.id] ?? 0,
          uniqueRate: rates[boss.id]?.unique ?? boss.unique.rate,
          gemRate: rates[boss.id]?.gem ?? boss.gem.rate,
          mapCost,
          iiq,
          timeSec: times[boss.id] ?? 180,
        }),
      )
      .sort((a, b) => b.profitPerHour - a.profitPerHour)
  }, [fragPrices, uniquePrices, gemPrices, rates, mapCost, iiq, times])

  const selected = ranked.find((r) => r.boss.id === selectedId) ?? ranked[0]
  const boss = selected?.boss

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="nightmare"
        title="Nightmare Boss Rush"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        EV calculator for Nightmare map boss farming — compare profit/hour across all 5 bosses.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={lab}>
          Map Cost
          <input
            style={inputStyle}
            type="number"
            value={mapCost}
            onChange={(e) => setMapCost(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          In Map IIQ %
          <input
            style={inputStyle}
            type="number"
            value={iiq}
            onChange={(e) => setIiq(Number(e.target.value) || 0)}
          />
        </label>
        <span style={{ color: theme.dim, fontSize: 12 }}>Avg Frags: {avgFrags.toFixed(2)}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 260,
            overflow: 'auto',
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            padding: 6,
          }}
        >
          {ranked.map((r, i) => (
            <button
              key={r.boss.id}
              type="button"
              onClick={() => setSelectedId(r.boss.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: r.boss.id === selectedId ? '#1e1a14' : 'transparent',
                border: 'none',
                borderRadius: 4,
                padding: '8px 6px',
                cursor: 'pointer',
                color: theme.text,
                marginBottom: 2,
              }}
            >
              <div style={{ color: r.boss.id === selectedId ? theme.accent : theme.text, fontWeight: 600 }}>
                {i + 1}. {r.boss.name}
              </div>
              <div style={{ fontSize: 10, color: theme.dim }}>
                EV {fmtChaos(r.totalEv, cpd)} · Cost {fmtChaos(mapCost, cpd)} · {r.timeSec}s/map
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ color: theme.green, fontWeight: 600 }}>
                  {fmtDivHr(r.profitPerHour, cpd)}
                </span>
                <span style={{ color: theme.dim, fontSize: 11 }}>
                  {fmtSignedChaos(r.profitPerMap, cpd)}/map
                </span>
              </div>
            </button>
          ))}
        </div>

        {boss && selected ? (
          <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6, padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 15 }}>
                <ItemName name={boss.name} opts={{ priceIcons }}>
                  {boss.name}
                </ItemName>
              </strong>
              <label style={lab}>
                Time / map (sec)
                <input
                  style={inputStyle}
                  type="number"
                  value={times[boss.id] ?? 180}
                  onChange={(e) =>
                    setTimes((t) => ({ ...t, [boss.id]: Number(e.target.value) || 180 }))
                  }
                />
              </label>
            </div>

            <Section title={`Fragments — ${fmtChaos(selected.fragEv, cpd)} EV`}>
              <div style={{ color: theme.dim, fontSize: 11, marginBottom: 6 }}>
                {selected.avgFrags.toFixed(2)} avg drops ({iiq}% IIQ)
              </div>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Fragment</th>
                    <th style={th}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {boss.fragments.map((id) => (
                    <tr key={id}>
                      <td style={td}>
                        <ItemName
                          name={DATA.fragmentNames[id] ?? idToName(id)}
                          opts={{ priceIcons, aliases: [idToName(id), id] }}
                        >
                          {DATA.fragmentNames[id] ?? id}
                        </ItemName>
                      </td>
                      <td style={td}>
                        <input
                          style={{ ...inputStyle, width: 80 }}
                          type="number"
                          value={fragPrices[id] ?? 0}
                          onChange={(e) =>
                            setFragPrices((p) => ({ ...p, [id]: Number(e.target.value) || 0 }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title={`Rare Drops — ${fmtChaos(selected.rareEv, cpd)} EV`}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Item</th>
                    <th style={th}>Rate %</th>
                    <th style={th}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={td}>
                      <ItemName
                        name={boss.unique.name}
                        opts={{
                          priceIcons,
                          aliases: [boss.unique.name.replace(/^Unid\s+/i, '')],
                        }}
                      >
                        {boss.unique.name}
                      </ItemName>
                    </td>
                    <td style={td}>
                      <input
                        style={{ ...inputStyle, width: 56 }}
                        type="number"
                        value={rates[boss.id]?.unique ?? boss.unique.rate}
                        onChange={(e) =>
                          setRates((r) => ({
                            ...r,
                            [boss.id]: {
                              ...r[boss.id],
                              unique: Number(e.target.value) || 0,
                              gem: r[boss.id]?.gem ?? boss.gem.rate,
                            },
                          }))
                        }
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={{ ...inputStyle, width: 80 }}
                        type="number"
                        value={uniquePrices[boss.id] ?? 0}
                        onChange={(e) =>
                          setUniquePrices((p) => ({ ...p, [boss.id]: Number(e.target.value) || 0 }))
                        }
                      />
                    </td>
                  </tr>
                  <tr>
                    <td style={td}>
                      <ItemName name={boss.gem.name} opts={{ priceIcons }}>
                        {boss.gem.name}
                      </ItemName>
                    </td>
                    <td style={td}>
                      <input
                        style={{ ...inputStyle, width: 56 }}
                        type="number"
                        value={rates[boss.id]?.gem ?? boss.gem.rate}
                        onChange={(e) =>
                          setRates((r) => ({
                            ...r,
                            [boss.id]: {
                              unique: r[boss.id]?.unique ?? boss.unique.rate,
                              gem: Number(e.target.value) || 0,
                            },
                          }))
                        }
                      />
                    </td>
                    <td style={td}>
                      <input
                        style={{ ...inputStyle, width: 80 }}
                        type="number"
                        value={gemPrices[boss.id] ?? 0}
                        onChange={(e) =>
                          setGemPrices((p) => ({ ...p, [boss.id]: Number(e.target.value) || 0 }))
                        }
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
              <span>
                TOTAL EV <strong>{fmtChaos(selected.totalEv, cpd)}</strong>
              </span>
              <span style={{ color: theme.green }}>
                PROFIT / MAP <strong>{fmtSignedChaos(selected.profitPerMap, cpd)}</strong>
              </span>
              <span style={{ color: theme.green }}>
                PROFIT / HOUR <strong>{fmtDivHr(selected.profitPerHour, cpd)}</strong>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: theme.accent, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

function fmtDivHr(chaosPerHour: number, cpd: number): string {
  const d = cpd > 0 ? chaosPerHour / cpd : 0
  const sign = d > 0 ? '+' : d < 0 ? '-' : ''
  return `${sign}${Math.abs(d).toFixed(1)}d/hr`
}

const lab: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 10,
  color: theme.dim,
}
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const th: CSSProperties = { textAlign: 'left', color: theme.dim, padding: '4px 6px', fontSize: 10 }
const td: CSSProperties = { padding: '4px 6px', borderTop: `1px solid ${theme.border}` }
