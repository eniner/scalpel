import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import bossesJson from '../data/bosses.json'
import {
  calculateBossEV,
  calculateProfitProbability,
  getRiskCategory,
  RISK_LABELS,
  type BossDef,
  type RiskCategory,
} from '../engines/boss'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, fmtSignedChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { accentBtnStyle, btnStyle, inputStyle, theme } from '../shared/theme'

type BossesFile = {
  baseNotes: string
  defaultTtk: Record<string, number>
  bosses: Record<string, BossDef>
}

const DATA = bossesJson as BossesFile

const RISK_ORDER: RiskCategory[] = ['safe', 'low', 'medium', 'high', 'negative']
const RISK_COLOR: Record<RiskCategory, string> = {
  safe: theme.green,
  low: theme.accent,
  medium: theme.accent,
  high: theme.red,
  negative: theme.red,
}

type CardRow = {
  id: string
  name: string
  entry: number
  profit: number
  profitProb: number
  ttkMin: number
  profitPerHour: number
  risk: RiskCategory
  quantityBonus?: number
}

export function BossProfitTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map())
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())
  const [simRuns, setSimRuns] = useState(10)
  const [simTrials, setSimTrials] = useState(500)
  const [sortMode, setSortMode] = useState<'ev' | 'hourly'>('ev')
  const [busy, setBusy] = useState(false)
  const [cards, setCards] = useState<CardRow[]>([])

  const lookup = useMemo(
    () => ({
      currency: (id: string) =>
        priceMap.get(idToName(id)) ?? priceMap.get(id) ?? priceMap.get(id.toLowerCase()) ?? 0,
      unique: (name: string) => {
        const clean = name.replace(/^Unid\s+/i, '')
        return priceMap.get(name) ?? priceMap.get(clean) ?? priceMap.get(name.toLowerCase()) ?? 0
      },
    }),
    [priceMap],
  )

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)
      const next = new Map<string, number>()
      for (const e of list) {
        if (Number.isFinite(e.chaosValue)) {
          next.set(e.name, e.chaosValue)
          next.set(e.name.toLowerCase(), e.chaosValue)
        }
      }
      // Also index by currency-id style for fragments
      for (const [id, boss] of Object.entries(DATA.bosses)) {
        for (const item of boss.entryItems) {
          const n = chaosForId(byName, item.id) ?? chaosForName(byName, item.name)
          if (n != null) {
            next.set(idToName(item.id), n)
            next.set(item.id, n)
          }
        }
        for (const drop of [...boss.guaranteedDrops, ...(boss.extraDrops || [])]) {
          if (drop.currencyId) {
            const n = chaosForId(byName, drop.currencyId) ?? chaosForName(byName, drop.name)
            if (n != null) {
              next.set(idToName(drop.currencyId), n)
              next.set(drop.currencyId, n)
            }
          }
        }
        void id
      }
      setPriceMap(next)
      setStatus(`Prices · ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const recompute = useCallback(() => {
    setBusy(true)
    // Yield so UI can paint
    setTimeout(() => {
      const rows: CardRow[] = []
      for (const [id, boss] of Object.entries(DATA.bosses)) {
        const { entry, profit } = calculateBossEV(boss, lookup)
        const profitProb = calculateProfitProbability(boss, lookup, simRuns, simTrials)
        const ttkMin = DATA.defaultTtk[id] ?? 3
        const profitPerHour = ttkMin > 0 ? (profit / (ttkMin * 60)) * 3600 : 0
        rows.push({
          id,
          name: boss.name,
          entry,
          profit,
          profitProb,
          ttkMin,
          profitPerHour,
          risk: getRiskCategory(profitProb, profit),
          quantityBonus: boss.quantityBonus,
        })
      }
      rows.sort((a, b) =>
        sortMode === 'hourly' ? b.profitPerHour - a.profitPerHour : b.profit - a.profit,
      )
      setCards(rows)
      setBusy(false)
    }, 20)
  }, [lookup, simRuns, simTrials, sortMode])

  useEffect(() => {
    if (priceMap.size > 0) recompute()
  }, [priceMap, recompute])

  const grouped = useMemo(() => {
    const g: Record<RiskCategory, CardRow[]> = {
      safe: [],
      low: [],
      medium: [],
      high: [],
      negative: [],
    }
    for (const c of cards) g[c.risk].push(c)
    return g
  }, [cards])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="boss-profit"
        title="Boss Profitability"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Expected value for boss encounters from drop rates and market prices.
      </p>
      <div
        style={{
          background: '#142033',
          border: '1px solid #2a4a6a',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: theme.blue,
        }}
      >
        Note: Drop weights may change. Update as more data is available. {DATA.baseNotes}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={lab}>
          Simulate runs
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={100}
            value={simRuns}
            onChange={(e) => setSimRuns(Number(e.target.value) || 10)}
          />
        </label>
        <label style={lab}>
          Trials
          <input
            style={inputStyle}
            type="number"
            min={50}
            max={2000}
            value={simTrials}
            onChange={(e) => setSimTrials(Number(e.target.value) || 500)}
          />
        </label>
        <button
          type="button"
          style={sortMode === 'ev' ? accentBtnStyle : btnStyle}
          onClick={() => setSortMode('ev')}
        >
          EV
        </button>
        <button
          type="button"
          style={sortMode === 'hourly' ? accentBtnStyle : btnStyle}
          onClick={() => setSortMode('hourly')}
        >
          Profit/hr
        </button>
        <button type="button" style={btnStyle} onClick={recompute} disabled={busy}>
          {busy ? 'Simulating…' : 'Re-run'}
        </button>
        <span style={{ color: theme.dim, fontSize: 10 }}>
          Chance for profit = % of trials profitable after N runs
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {RISK_ORDER.map((risk) => {
          const list = grouped[risk]
          if (!list.length) return null
          return (
            <div key={risk} style={{ marginBottom: 14 }}>
              <div
                style={{
                  color: RISK_COLOR[risk],
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '0.04em',
                  marginBottom: 8,
                }}
              >
                {RISK_LABELS[risk]} {list.length} bosses
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 8,
                }}
              >
                {list.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: theme.panel,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <strong style={{ fontSize: 13 }}>
                        <ItemName name={c.name} opts={{ priceIcons }}>
                          {c.name}
                        </ItemName>
                      </strong>
                      {c.quantityBonus ? (
                        <span style={{ color: theme.accent, fontSize: 11 }}>+{c.quantityBonus}%</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>
                      Entry: {fmtChaos(c.entry, cpd)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
                      <span style={{ color: theme.blue }}>
                        {Math.round(c.profitProb * 100)}% chance to profit
                      </span>
                      <span style={{ color: c.profit >= 0 ? theme.green : theme.red }}>
                        EV: {fmtSignedChaos(c.profit, cpd)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 6,
                        fontSize: 11,
                        color: theme.purple,
                      }}
                    >
                      <span>{fmtTtk(c.ttkMin)} TTK</span>
                      <span style={{ color: c.profitPerHour >= 0 ? theme.blue : theme.red }}>
                        {fmtDivHr(c.profitPerHour, cpd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function fmtTtk(minutes: number): string {
  const totalSec = Math.round(minutes * 60)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
