import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import beastsRefJson from '../data/beasts-ref.json'
import {
  computeBeastFarm,
  optimizeBeastFarm,
  type Beast,
  type BeastAtlasBonuses,
  type BeastClassificationBoosts,
  type BeastScarabConfig,
  type BeastThhMarkup,
  type BeastsRef,
} from '../engines/beasts'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, fmtSignedChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { accentBtnStyle, btnStyle, inputStyle, theme } from '../shared/theme'

const REF = beastsRefJson as BeastsRef
const BEASTS = REF.beasts

const HERD_SCARAB_ID = 'bestiary-scarab-of-the-herd'
const DUPLICATING_SCARAB_ID = 'bestiary-scarab-of-duplicating'

const DEFAULT_ATLAS: BeastAtlasBonuses = {
  additionalRedPct: 30,
  additionalYellow: 2,
  yellowToRedPct: 15,
  pairChancePct: 8,
}

const DEFAULT_THH: BeastThhMarkup = { markup10Pct: 5, markup20Pct: 10 }

const DEFAULT_SCARABS: BeastScarabConfig = {
  herdQty: 0,
  herdPrice: 0,
  duplicatingQty: 0,
  duplicatingPrice: 0,
}

export function BeastsTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [atlas, setAtlas] = useState<BeastAtlasBonuses>(DEFAULT_ATLAS)
  const [thh, setThh] = useState<BeastThhMarkup>(DEFAULT_THH)
  const [scarabs, setScarabs] = useState<BeastScarabConfig>(DEFAULT_SCARABS)
  const [boosts, setBoosts] = useState<BeastClassificationBoosts>(() =>
    Object.fromEntries(REF.classifications.map((c) => [c, false])),
  )
  const [yellowPrice, setYellowPrice] = useState(0)
  const [discardBelow, setDiscardBelow] = useState(5)
  const [timeSec, setTimeSec] = useState(240)
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number | null>>({})
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const priceFor = useCallback(
    (beast: Beast): number | null => {
      const override = priceOverrides[beast.name]
      if (override !== undefined) return override
      return null
    },
    [priceOverrides],
  )

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)

      const next: Record<string, number | null> = {}
      for (const beast of BEASTS) {
        const byId = beast.priceId ? chaosForId(byName, beast.priceId) : null
        next[beast.name] = byId ?? chaosForName(byName, beast.name)
      }
      setPriceOverrides(next)

      setScarabs((s) => ({
        ...s,
        herdPrice: chaosForId(byName, HERD_SCARAB_ID) ?? s.herdPrice,
        duplicatingPrice: chaosForId(byName, DUPLICATING_SCARAB_ID) ?? s.duplicatingPrice,
      }))

      setStatus(`Prices · ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const result = useMemo(
    () =>
      computeBeastFarm({
        beasts: BEASTS,
        classificationBoosts: boosts,
        priceFor,
        atlas,
        thh,
        scarabs,
        yellowPrice,
        discardBelow,
        timePerMapSec: timeSec,
      }),
    [boosts, priceFor, atlas, thh, scarabs, yellowPrice, discardBelow, timeSec],
  )

  const optimize = () => {
    setBusy(true)
    setTimeout(() => {
      const best = optimizeBeastFarm(
        {
          beasts: BEASTS,
          classificationBoosts: boosts,
          priceFor,
          atlas,
          thh,
          scarabs,
          yellowPrice,
          discardBelow,
          timePerMapSec: timeSec,
        },
        REF.classifications,
      )
      setScarabs((s) => ({ ...s, herdQty: best.herdQty, duplicatingQty: best.duplicatingQty }))
      setBoosts(best.boosts)
      setBusy(false)
    }, 10)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="beasts"
        title="Beast Farming EV"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Expected value for Bestiary beast captures — Atlas passive bonuses, Two-Hearted Hunt, and classification
        boosts.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <Field label="+ Red %">
          <input
            style={inputStyle}
            type="number"
            value={atlas.additionalRedPct}
            onChange={(e) => setAtlas((a) => ({ ...a, additionalRedPct: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="+ Yellow">
          <input
            style={inputStyle}
            type="number"
            value={atlas.additionalYellow}
            onChange={(e) => setAtlas((a) => ({ ...a, additionalYellow: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="Yellow → Red %">
          <input
            style={inputStyle}
            type="number"
            value={atlas.yellowToRedPct}
            onChange={(e) => setAtlas((a) => ({ ...a, yellowToRedPct: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="Pair %">
          <input
            style={inputStyle}
            type="number"
            value={atlas.pairChancePct}
            onChange={(e) => setAtlas((a) => ({ ...a, pairChancePct: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="THH 10% Markup">
          <input
            style={inputStyle}
            type="number"
            value={thh.markup10Pct}
            onChange={(e) => setThh((t) => ({ ...t, markup10Pct: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="THH 20% Markup">
          <input
            style={inputStyle}
            type="number"
            value={thh.markup20Pct}
            onChange={(e) => setThh((t) => ({ ...t, markup20Pct: Number(e.target.value) || 0 }))}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <Field label="Herd Scarabs">
          <input
            style={{ ...inputStyle, width: 48 }}
            type="number"
            min={0}
            value={scarabs.herdQty}
            onChange={(e) => setScarabs((s) => ({ ...s, herdQty: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="Herd Price">
          <input
            style={inputStyle}
            type="number"
            value={scarabs.herdPrice}
            onChange={(e) => setScarabs((s) => ({ ...s, herdPrice: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="Duplicating">
          <input
            type="checkbox"
            checked={scarabs.duplicatingQty > 0}
            onChange={(e) => setScarabs((s) => ({ ...s, duplicatingQty: e.target.checked ? 1 : 0 }))}
          />
        </Field>
        <Field label="Duplicating Price">
          <input
            style={inputStyle}
            type="number"
            value={scarabs.duplicatingPrice}
            onChange={(e) => setScarabs((s) => ({ ...s, duplicatingPrice: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="Yellow Price">
          <input
            style={inputStyle}
            type="number"
            value={yellowPrice}
            onChange={(e) => setYellowPrice(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Discard Below">
          <input
            style={inputStyle}
            type="number"
            value={discardBelow}
            onChange={(e) => setDiscardBelow(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Sec / Map">
          <input
            style={inputStyle}
            type="number"
            value={timeSec}
            onChange={(e) => setTimeSec(Number(e.target.value) || 240)}
          />
        </Field>
        <button type="button" style={accentBtnStyle} onClick={optimize} disabled={busy}>
          {busy ? 'Optimizing…' : 'Optimize'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={{ color: theme.dim, fontSize: 10 }}>CLASSIFICATION BOOST (x2)</span>
        {REF.classifications.map((c) => (
          <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={!!boosts[c]}
              onChange={(e) => setBoosts((b) => ({ ...b, [c]: e.target.checked }))}
            />
            {c}
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="RED / YELLOW SPAWNS" value={`${result.effectiveRed.toFixed(2)} / ${result.effectiveYellow.toFixed(2)}`} />
        <Stat label="TOTAL RED BEASTS / MAP" value={result.totalRedBeasts.toFixed(2)} />
        <Stat label="EV / RED BEAST" value={fmtChaos(result.evPerRedBeast, cpd)} color={theme.purple} />
        <Stat label="SCARAB COST / MAP" value={fmtSignedChaos(-result.scarabCost, cpd)} color={theme.red} />
        <Stat label="GROSS EV / MAP" value={fmtChaos(result.grossEvPerMap, cpd)} />
        <Stat label="NET EV / MAP" value={fmtSignedChaos(result.netEvPerMap, cpd)} color={theme.green} />
        <Stat label="NET EV / HOUR" value={fmtSignedChaos(result.netEvPerHour, cpd)} color={theme.green} />
        <Stat label="THH RATE" value={`${(result.thhRate * 100).toFixed(1)}%`} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: theme.dim, textAlign: 'left' }}>
              <th style={th}>BEAST</th>
              <th style={th}>CLASS</th>
              <th style={th}>WEIGHT</th>
              <th style={th}>PROB %</th>
              <th style={th}>PRICE</th>
              <th style={th}>EV CONTRIB</th>
            </tr>
          </thead>
          <tbody>
            {result.distribution.map((row) => (
              <tr
                key={row.beast.name}
                style={{
                  borderTop: `1px solid ${theme.border}`,
                  opacity: row.discarded ? 0.45 : 1,
                }}
              >
                <td style={td}>
                  <ItemName
                    name={row.beast.name}
                    opts={{
                      priceIcons,
                      aliases: row.beast.priceId ? [idToName(row.beast.priceId)] : undefined,
                    }}
                  >
                    {row.beast.name}
                    {row.boostMult > 1 ? <span style={{ color: theme.accent }}> x{row.boostMult}</span> : null}
                  </ItemName>
                </td>
                <td style={{ ...td, color: theme.dim }}>{row.beast.classification}</td>
                <td style={td}>{row.weight.toFixed(1)}</td>
                <td style={td}>{(row.probability * 100).toFixed(2)}%</td>
                <td style={td}>{row.hasPrice ? fmtChaos(row.price, cpd) : '—'}</td>
                <td style={{ ...td, color: theme.green }}>{fmtChaos(row.contribution, cpd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }}>
      {label}
      {children}
    </label>
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
