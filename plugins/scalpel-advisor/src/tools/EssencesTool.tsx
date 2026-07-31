import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import essencesRefJson from '../data/essences-ref.json'
import {
  computeEssenceFarm,
  essenceId,
  type EssenceValuationMode,
  type EssenceVaalMode,
  type EssencesRef,
} from '../engines/essences'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, fmtSignedChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { inputStyle, theme } from '../shared/theme'

const REF = essencesRefJson as EssencesRef

type ScarabState = {
  ascentQty: number
  ascentPrice: number
  essenceQty: number
  essencePrice: number
  calcificationQty: number
  calcificationPrice: number
  adversariesQty: number
  adversariesPrice: number
  stabilityQty: number
  stabilityPrice: number
}

const DEFAULT_SCARABS: ScarabState = {
  ascentQty: 0,
  ascentPrice: 1,
  essenceQty: 0,
  essencePrice: 1,
  calcificationQty: 0,
  calcificationPrice: 5,
  adversariesQty: 0,
  adversariesPrice: 1,
  stabilityQty: 0,
  stabilityPrice: 10,
}

const SCARAB_IDS: Record<keyof Omit<ScarabState, 'ascentPrice' | 'essencePrice' | 'calcificationPrice' | 'adversariesPrice' | 'stabilityPrice'>, string> = {
  ascentQty: 'essence-scarab-of-ascent',
  essenceQty: 'essence-scarab',
  calcificationQty: 'essence-scarab-of-calcification',
  adversariesQty: 'scarab-of-adversaries',
  stabilityQty: 'essence-scarab-of-stability',
}

export function EssencesTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [rareMonstersPerMap, setRareMonstersPerMap] = useState(10)
  const [timeSec, setTimeSec] = useState(240)
  const [valuation, setValuation] = useState<EssenceValuationMode>('deafening')
  const [vaalMode, setVaalMode] = useState<EssenceVaalMode>('all')
  const [vaalOrbPrice, setVaalOrbPrice] = useState(1)
  const [amplifiedEnergies, setAmplifiedEnergies] = useState(false)
  const [prolificEssence, setProlificEssence] = useState(false)
  const [crystalLattice, setCrystalLattice] = useState(true)
  const [crystalResonance, setCrystalResonance] = useState(false)
  const [scarabs, setScarabs] = useState<ScarabState>(DEFAULT_SCARABS)
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number | null>>({})
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const priceFor = useCallback((id: string): number | null => priceOverrides[id] ?? null, [priceOverrides])

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)

      const next: Record<string, number | null> = {}
      for (const group of REF.groups) {
        for (const essence of group.essences) {
          for (let tierIdx = 0; tierIdx <= group.maxTier; tierIdx++) {
            const id = essenceId(REF.tiers[tierIdx], essence)
            next[id] = chaosForId(byName, id)
          }
        }
      }
      setPriceOverrides(next)

      setScarabs((s) => ({
        ...s,
        ascentPrice: chaosForId(byName, SCARAB_IDS.ascentQty) ?? s.ascentPrice,
        essencePrice: chaosForId(byName, SCARAB_IDS.essenceQty) ?? s.essencePrice,
        calcificationPrice: chaosForId(byName, SCARAB_IDS.calcificationQty) ?? s.calcificationPrice,
        adversariesPrice: chaosForId(byName, SCARAB_IDS.adversariesQty) ?? s.adversariesPrice,
        stabilityPrice: chaosForId(byName, SCARAB_IDS.stabilityQty) ?? s.stabilityPrice,
      }))
      setVaalOrbPrice((v) => chaosForId(byName, 'vaal-orb') ?? v)

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
      computeEssenceFarm({
        groups: REF.groups,
        tiers: REF.tiers,
        weights: REF.weights,
        priceFor,
        valuation,
        rareMonstersPerMap,
        crystalLattice,
        amplifiedEnergies,
        prolificEssence,
        crystalResonance,
        ascentQty: scarabs.ascentQty,
        ascentPrice: scarabs.ascentPrice,
        essenceQty: scarabs.essenceQty,
        essencePrice: scarabs.essencePrice,
        calcificationQty: scarabs.calcificationQty,
        calcificationPrice: scarabs.calcificationPrice,
        adversariesQty: scarabs.adversariesQty,
        adversariesPrice: scarabs.adversariesPrice,
        stabilityQty: scarabs.stabilityQty,
        stabilityPrice: scarabs.stabilityPrice,
        vaalMode,
        vaalOrbPrice,
        timePerMapSec: timeSec,
      }),
    [
      priceFor,
      valuation,
      rareMonstersPerMap,
      crystalLattice,
      amplifiedEnergies,
      prolificEssence,
      crystalResonance,
      scarabs,
      vaalMode,
      vaalOrbPrice,
      timeSec,
    ],
  )

  const setScarabQty = (key: keyof typeof SCARAB_IDS, value: number) =>
    setScarabs((s) => ({ ...s, [key]: value }))
  const setScarabPrice = (
    key: 'ascentPrice' | 'essencePrice' | 'calcificationPrice' | 'adversariesPrice' | 'stabilityPrice',
    value: number,
  ) => setScarabs((s) => ({ ...s, [key]: value }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="essences"
        title="Essence Farming EV"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Weighted essence-drop EV with essence-scarab combos, Vaal outcomes, and 3:1 upgrade valuation.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
        <ScarabField
          name="Ascent"
          qty={scarabs.ascentQty}
          maxQty={1}
          price={scarabs.ascentPrice}
          onQty={(v) => setScarabQty('ascentQty', v)}
          onPrice={(v) => setScarabPrice('ascentPrice', v)}
        />
        <ScarabField
          name="Essence (+3 monsters)"
          qty={scarabs.essenceQty}
          maxQty={5}
          price={scarabs.essencePrice}
          onQty={(v) => setScarabQty('essenceQty', v)}
          onPrice={(v) => setScarabPrice('essencePrice', v)}
        />
        <ScarabField
          name="Calcification"
          qty={scarabs.calcificationQty}
          maxQty={1}
          price={scarabs.calcificationPrice}
          onQty={(v) => setScarabQty('calcificationQty', v)}
          onPrice={(v) => setScarabPrice('calcificationPrice', v)}
        />
        <ScarabField
          name="Adversaries (+4 rares)"
          qty={scarabs.adversariesQty}
          maxQty={2}
          price={scarabs.adversariesPrice}
          onQty={(v) => setScarabQty('adversariesQty', v)}
          onPrice={(v) => setScarabPrice('adversariesPrice', v)}
        />
        <ScarabField
          name="Stability"
          qty={scarabs.stabilityQty}
          maxQty={1}
          price={scarabs.stabilityPrice}
          onQty={(v) => setScarabQty('stabilityQty', v)}
          onPrice={(v) => setScarabPrice('stabilityPrice', v)}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <Field label="Rare Monsters / Map">
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={rareMonstersPerMap}
            onChange={(e) => setRareMonstersPerMap(Number(e.target.value) || 1)}
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
        <Field label="Valuation">
          <select
            style={inputStyle}
            value={valuation}
            onChange={(e) => setValuation(e.target.value as EssenceValuationMode)}
          >
            <option value="all">All Tiers</option>
            <option value="shrieking">Shrieking+</option>
            <option value="deafening">Deafening</option>
          </select>
        </Field>
        <Field label="Vaal Mode">
          <select style={inputStyle} value={vaalMode} onChange={(e) => setVaalMode(e.target.value as EssenceVaalMode)}>
            <option value="none">Don't Vaal</option>
            <option value="all">Vaal All</option>
            <option value="meds">MEDS Only</option>
          </select>
        </Field>
        <Field label="Vaal Orb Price">
          <input
            style={inputStyle}
            type="number"
            value={vaalOrbPrice}
            onChange={(e) => setVaalOrbPrice(Number(e.target.value) || 0)}
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <input type="checkbox" checked={amplifiedEnergies} onChange={(e) => setAmplifiedEnergies(e.target.checked)} />
          Amplified Energies
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <input type="checkbox" checked={prolificEssence} onChange={(e) => setProlificEssence(e.target.checked)} />
          Prolific Essence
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <input type="checkbox" checked={crystalLattice} onChange={(e) => setCrystalLattice(e.target.checked)} />
          Crystal Lattice
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <input type="checkbox" checked={crystalResonance} onChange={(e) => setCrystalResonance(e.target.checked)} />
          Crystal Resonance
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="ESS / MONSTER" value={result.essPerMonster.toFixed(2)} />
        <Stat label="TOTAL ESSENCES / MAP" value={result.totalEssences.toFixed(1)} />
        <Stat label="EV / ESSENCE" value={fmtChaos(result.totalEV, cpd)} color={theme.purple} />
        <Stat label="VAAL MULT" value={`${result.vaalMultiplier.toFixed(2)}x`} />
        <Stat label="EV / MAP" value={fmtChaos(result.evPerMap, cpd)} />
        <Stat label="SCARAB + VAAL COST" value={fmtSignedChaos(-result.totalCost, cpd)} color={theme.red} />
        <Stat label="NET PROFIT / MAP" value={fmtSignedChaos(result.netProfitPerMap, cpd)} color={theme.green} />
        <Stat label="NET PROFIT / HOUR" value={fmtSignedChaos(result.netProfitPerHour, cpd)} color={theme.green} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: theme.dim, textAlign: 'left' }}>
              <th style={th}>ESSENCE</th>
              <th style={th}>TIER</th>
              <th style={th}>PROB %</th>
              <th style={th}>PRICE</th>
              <th style={th}>OVERRIDE</th>
              <th style={th}>EV CONTRIB</th>
            </tr>
          </thead>
          <tbody>
            {result.breakdown.map((row) => (
              <tr key={row.id} style={{ borderTop: `1px solid ${theme.border}` }}>
                <td style={td}>
                  <ItemName name={idToName(row.id)} opts={{ priceIcons }} style={{ textTransform: 'capitalize' }}>
                    {row.essence}
                  </ItemName>
                </td>
                <td style={{ ...td, color: theme.dim, textTransform: 'capitalize' }}>{row.tier}</td>
                <td style={td}>{(row.probability * 100).toFixed(2)}%</td>
                <td style={td}>{fmtChaos(row.price, cpd)}</td>
                <td style={td}>
                  <input
                    style={{ ...inputStyle, width: 70 }}
                    placeholder="—"
                    value={priceOverrides[row.id] != null ? String(Math.round((priceOverrides[row.id] ?? 0) * 100) / 100) : ''}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setPriceOverrides((p) => ({ ...p, [row.id]: Number.isFinite(v) && e.target.value !== '' ? v : null }))
                    }}
                  />
                </td>
                <td style={{ ...td, color: theme.green }}>{fmtChaos(row.valuedContribution, cpd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScarabField({
  name,
  qty,
  maxQty,
  price,
  onQty,
  onPrice,
}: {
  name: string
  qty: number
  maxQty: number
  price: number
  onQty: (v: number) => void
  onPrice: (v: number) => void
}) {
  return (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600 }}>{name}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          style={{ ...inputStyle, width: 44 }}
          value={qty}
          onChange={(e) => onQty(Number(e.target.value) || 0)}
        >
          {Array.from({ length: maxQty + 1 }, (_, i) => i).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          style={{ ...inputStyle, width: 60 }}
          type="number"
          step="0.1"
          value={price}
          onChange={(e) => onPrice(Number(e.target.value) || 0)}
        />
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
