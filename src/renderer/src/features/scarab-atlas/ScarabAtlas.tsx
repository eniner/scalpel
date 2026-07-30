import { useCallback, useEffect, useMemo, useState } from 'react'
import itemIcons from '@shared/data/items/item-icons-poe1.json'
import { Button } from '../../components/primitives/Button'
import { Toggle } from '../../components/Toggle'
import { IconGlow } from '../../shared/IconGlow'
import { zebraRowBg } from '../../shared/utils'
import catalogJson from './scarab-catalog.json'
import type { ScarabCategory } from './types'
import {
  buildVendorSearchString,
  calculateCategoryEV,
  calculateOptimalStrategy,
  calculatePoolEV,
  formatChaos,
  getEffectivePrice,
  getEffectiveWeight,
  loadState,
  saveState,
  shortenScarabName,
  toggleInList,
} from './calc'
import type { ScarabCalcState, ScarabCatalog, TabId } from './types'

const catalog = catalogJson as ScarabCatalog
const SCARAB_ICONS = itemIcons as Record<string, string>

function scarabIconUrl(name: string): string | null {
  return SCARAB_ICONS[name] ?? null
}

/** Prefer the plain "{Category} Scarab" art, else first scarab with an icon. */
function categoryIconUrl(cat: ScarabCategory): string | null {
  const plain = `${cat.name} Scarab`
  if (SCARAB_ICONS[plain]) return SCARAB_ICONS[plain]
  for (const s of cat.scarabs) {
    const url = scarabIconUrl(s.name)
    if (url) return url
  }
  return null
}

function ScarabIcon({ name, url, size = 20 }: { name?: string; url?: string | null; size?: number }): JSX.Element {
  const src = url !== undefined ? url : name ? scarabIconUrl(name) : null
  if (!src) {
    return (
      <div
        className="shrink-0 rounded bg-white/[0.04] border border-white/[0.06]"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }
  return <IconGlow src={src} size={size} blur={8} saturate={2.2} opacity={0.35} />
}

function tabClass(active: boolean): string {
  return [
    'px-3 py-1.5 text-xs rounded border transition-colors',
    active
      ? 'border-white/20 bg-white/10 font-semibold text-text'
      : 'border-white/10 bg-black/20 text-text-dim hover:text-text',
  ].join(' ')
}

export function ScarabAtlas(): JSX.Element {
  const [tab, setTab] = useState<TabId>('calculator')
  const [state, setState] = useState<ScarabCalcState>(() => loadState())
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [league, setLeague] = useState('')
  const [loading, setLoading] = useState(true)
  const [vendorSearch, setVendorSearch] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const updateState = useCallback((patch: Partial<ScarabCalcState> | ((prev: ScarabCalcState) => ScarabCalcState)) => {
    setState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
      saveState(next)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchPrices = async (attempt = 0): Promise<void> => {
      try {
        const settings = await window.api.getSettings()
        const activeLeague = settings.activeProfile?.league ?? ''
        if (!cancelled) setLeague(activeLeague)
        const names = catalog.categories.flatMap((c) => c.scarabs.map((s) => s.name))
        const result: Record<string, number> = {}
        const chunkSize = 200
        for (let i = 0; i < names.length; i += chunkSize) {
          const chunk = names.slice(i, i + chunkSize)
          const p = await window.api.batchLookupPrices(chunk, activeLeague)
          for (const [name, info] of Object.entries(p)) {
            if (info?.chaosValue) result[name] = info.chaosValue
          }
        }
        if (cancelled) return
        if (Object.keys(result).length === 0 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000))
          if (!cancelled) return fetchPrices(attempt + 1)
          return
        }
        setPrices(result)
      } catch {
        if (!cancelled && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000))
          if (!cancelled) return fetchPrices(attempt + 1)
          return
        }
      }
      if (!cancelled) setLoading(false)
    }
    void fetchPrices()
    return () => {
      cancelled = true
    }
  }, [])

  const baselineEV = useMemo(
    () =>
      calculatePoolEV(catalog, state, prices, {
        blocks: [],
        boosts: [],
        investments: [],
      }),
    [state, prices],
  )
  const currentEV = useMemo(() => calculatePoolEV(catalog, state, prices), [state, prices])
  const optimal = useMemo(() => calculateOptimalStrategy(catalog, state, prices), [state, prices])

  const sortedCategories = useMemo(() => {
    return [...catalog.categories]
      .map((cat) => ({ cat, ...calculateCategoryEV(cat, state, prices) }))
      .sort((a, b) => b.ev - a.ev)
  }, [state, prices])

  const applyOptimize = (): void => {
    updateState({
      blocked: optimal.blocks,
      boosted: optimal.boosts,
      invested: optimal.investments,
    })
  }

  const resetBiases = (): void => {
    updateState({ blocked: [], boosted: [], invested: [] })
  }

  const generateVendor = (): void => {
    const result = buildVendorSearchString(catalog, state, prices)
    setVendorSearch(result.search)
  }

  const copyVendor = async (): Promise<void> => {
    if (!vendorSearch || vendorSearch.startsWith('(')) return
    try {
      await navigator.clipboard.writeText(vendorSearch)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const pricedCount = Object.keys(prices).length
  const totalScarabs = catalog.categories.reduce((n, c) => n + c.scarabs.length, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="bg-bg-card px-3 py-[10px] border-b border-border shrink-0 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="section-title">Scarab Atlas</span>
            <p className="text-[11px] text-text-dim mt-1 mb-0 leading-relaxed">
              Block low-EV categories, boost high-EV ones. Prices follow your Scalpel league
              {league ? ` (${league})` : ''}.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            <span className="text-[10px] text-text-dim">Remarkable Relics</span>
            <Toggle
              checked={state.remarkableRelics}
              onChange={(checked) => updateState({ remarkableRelics: checked })}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={tabClass(tab === 'calculator')} onClick={() => setTab('calculator')}>
            Calculator
          </button>
          <button type="button" className={tabClass(tab === 'vendor')} onClick={() => setTab('vendor')}>
            Vendor Guide
          </button>
          <button type="button" className={tabClass(tab === 'weights')} onClick={() => setTab('weights')}>
            Weights & Prices
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span>
            <span className="text-text-dim">Baseline </span>
            <span className="text-text font-medium">{loading ? '…' : formatChaos(baselineEV)}</span>
          </span>
          <span>
            <span className="text-text-dim">Current </span>
            <span className="text-accent font-semibold">{loading ? '…' : formatChaos(currentEV)}</span>
          </span>
          <span>
            <span className="text-text-dim">Optimal </span>
            <span className="text-emerald-400 font-medium">{loading ? '…' : formatChaos(optimal.ev)}</span>
          </span>
          <span className="text-text-dim">
            {pricedCount}/{totalScarabs} priced
          </span>
          <div className="flex gap-1.5 ml-auto">
            <Button size="sm" variant="ghost" onClick={resetBiases}>
              Reset
            </Button>
            <Button size="sm" variant="primary" onClick={applyOptimize} disabled={loading}>
              Optimize
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-bg-solid min-h-0">
        {tab === 'calculator' && (
          <div className="p-2 space-y-2">
            <div className="px-2 py-1.5 text-[10px] text-text-dim border border-white/10 rounded bg-black/20">
              Optimize suggests blocks (below pool EV), atlas boosts (2×), and investments (1.5×). Marginals show ΔEV vs
              optimal.
            </div>
            {sortedCategories.map(({ cat, ev, weight }, i) => {
              const blocked = state.blocked.includes(cat.id)
              const boosted = state.boosted.includes(cat.id)
              const invested = state.invested.includes(cat.id)
              const mg = optimal.marginals[cat.id]
              return (
                <div
                  key={cat.id}
                  className="rounded border border-white/10 px-2.5 py-2"
                  style={{ background: zebraRowBg(i), opacity: blocked ? 0.55 : 1 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ScarabIcon url={categoryIconUrl(cat)} size={22} />
                      <span className="text-[12px] font-medium text-text truncate">{cat.name}</span>
                      <span className="text-[9px] uppercase tracking-wide text-text-dim shrink-0">
                        {cat.atlasModifier}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {cat.atlasModifier === 'blockable' && (
                        <Button
                          size="sm"
                          variant={blocked ? 'danger' : 'ghost'}
                          onClick={() =>
                            updateState((prev) => ({
                              ...prev,
                              blocked: toggleInList(prev.blocked, cat.id),
                              invested: prev.invested.filter((id) => id !== cat.id),
                            }))
                          }
                        >
                          Block
                        </Button>
                      )}
                      {cat.atlasModifier === 'boostable' && (
                        <Button
                          size="sm"
                          variant={boosted ? 'primary' : 'ghost'}
                          onClick={() =>
                            updateState((prev) => ({
                              ...prev,
                              boosted: toggleInList(prev.boosted, cat.id),
                            }))
                          }
                        >
                          Boost
                        </Button>
                      )}
                      {cat.investmentBoost && (
                        <Button
                          size="sm"
                          variant={invested ? 'primary' : 'ghost'}
                          disabled={blocked}
                          onClick={() =>
                            updateState((prev) => ({
                              ...prev,
                              invested: toggleInList(prev.invested, cat.id),
                              blocked: prev.blocked.filter((id) => id !== cat.id),
                            }))
                          }
                        >
                          Invest
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-dim">
                    <span>
                      EV <span className="text-text">{formatChaos(ev)}</span>
                    </span>
                    <span>
                      Weight <span className="text-text">{Math.round(weight)}</span>
                    </span>
                    <span>
                      Count <span className="text-text">{cat.scarabs.length}</span>
                    </span>
                    {mg?.block != null && (
                      <span className={mg.block >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        block {mg.block >= 0 ? '+' : ''}
                        {formatChaos(mg.block)}
                      </span>
                    )}
                    {mg?.boost != null && (
                      <span className={mg.boost >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        boost {mg.boost >= 0 ? '+' : ''}
                        {formatChaos(mg.boost)}
                      </span>
                    )}
                    {mg?.invest != null && (
                      <span className={mg.invest >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        invest {mg.invest >= 0 ? '+' : ''}
                        {formatChaos(mg.invest)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'vendor' && (
          <VendorTab
            state={state}
            prices={prices}
            vendorSearch={vendorSearch}
            copied={copied}
            onGenerate={generateVendor}
            onCopy={() => void copyVendor()}
          />
        )}

        {tab === 'weights' && (
          <WeightsTab
            state={state}
            prices={prices}
            onSetWeight={(id, value) =>
              updateState((prev) => {
                const next = { ...prev.weightOverrides }
                if (value == null) delete next[id]
                else next[id] = value
                return { ...prev, weightOverrides: next }
              })
            }
            onSetPrice={(id, value) =>
              updateState((prev) => {
                const next = { ...prev.priceOverrides }
                if (value == null) delete next[id]
                else next[id] = value
                return { ...prev, priceOverrides: next }
              })
            }
            onResetWeights={() => updateState({ weightOverrides: {} })}
            onResetPrices={() => updateState({ priceOverrides: {} })}
          />
        )}
      </div>
    </div>
  )
}

function VendorTab({
  state,
  prices,
  vendorSearch,
  copied,
  onGenerate,
  onCopy,
}: {
  state: ScarabCalcState
  prices: Record<string, number>
  vendorSearch: string | null
  copied: boolean
  onGenerate: () => void
  onCopy: () => void
}): JSX.Element {
  const baseline = calculatePoolEV(catalog, state, prices, {
    blocks: [],
    boosts: [],
    investments: [],
    applyRemarkable: false,
  })
  const threshold = baseline / 3
  const order = catalog.vendorCategoryOrder

  const categories = [...catalog.categories].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.name.localeCompare(b.name),
  )

  return (
    <div className="p-2 space-y-2">
      <div className="px-2 py-1.5 text-[11px] text-text-dim border border-white/10 rounded bg-black/20 leading-relaxed">
        Sell any 3 scarabs → 1 random. Random EV{' '}
        <span className="text-accent font-medium">{formatChaos(baseline)}</span> (raw weights). Vendor if under{' '}
        <span className="text-accent font-medium">{formatChaos(threshold)}</span>.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={onGenerate}>
          Generate Search String
        </Button>
        {vendorSearch && (
          <>
            <input
              readOnly
              value={vendorSearch}
              className="flex-1 min-w-[140px] text-[11px] px-2 py-1 rounded border border-white/10 bg-black/30 text-text"
            />
            <Button size="sm" variant="secondary" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </>
        )}
      </div>
      {categories.map((cat, i) => {
        const vendorable = cat.scarabs
          .filter((s) => getEffectivePrice(s, state, prices) < threshold)
          .sort((a, b) => getEffectivePrice(a, state, prices) - getEffectivePrice(b, state, prices))
        return (
          <div
            key={cat.id}
            className="rounded border border-white/10 px-2.5 py-2"
            style={{ background: zebraRowBg(i), opacity: vendorable.length ? 1 : 0.45 }}
          >
            <div className="flex justify-between text-[12px] items-center gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <ScarabIcon url={categoryIconUrl(cat)} size={18} />
                <span className="font-medium truncate">{cat.name}</span>
              </div>
              <span className="text-text-dim text-[10px] shrink-0">
                {vendorable.length}/{cat.scarabs.length}
              </span>
            </div>
            {vendorable.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {vendorable.map((s) => {
                  const price = getEffectivePrice(s, state, prices)
                  const profit = baseline - price * 3
                  return (
                    <div key={s.id} className="flex justify-between gap-2 text-[10px] items-center">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ScarabIcon name={s.name} size={16} />
                        <span className="truncate text-text-dim" title={s.name}>
                          {shortenScarabName(s.name)}
                        </span>
                      </div>
                      <span className="shrink-0">
                        <span className="text-text">{formatChaos(price)}</span>
                        <span className="text-emerald-400 ml-2">+{formatChaos(profit)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WeightsTab({
  state,
  prices,
  onSetWeight,
  onSetPrice,
  onResetWeights,
  onResetPrices,
}: {
  state: ScarabCalcState
  prices: Record<string, number>
  onSetWeight: (id: string, value: number | null) => void
  onSetPrice: (id: string, value: number | null) => void
  onResetWeights: () => void
  onResetPrices: () => void
}): JSX.Element {
  const sorted = useMemo(() => {
    return [...catalog.categories]
      .map((cat) => ({ cat, ...calculateCategoryEV(cat, state, prices) }))
      .sort((a, b) => b.ev - a.ev)
  }, [state, prices])

  return (
    <div className="p-2 space-y-2">
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={onResetWeights}>
          Reset Weights
        </Button>
        <Button size="sm" variant="ghost" onClick={onResetPrices}>
          Reset Prices
        </Button>
      </div>
      {sorted.map(({ cat, ev }, i) => (
        <div key={cat.id} className="rounded border border-white/10 px-2.5 py-2" style={{ background: zebraRowBg(i) }}>
          <div className="flex justify-between text-[12px] mb-1.5 items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ScarabIcon url={categoryIconUrl(cat)} size={18} />
              <span className="font-medium truncate">{cat.name}</span>
            </div>
            <span className="text-text-dim text-[10px] shrink-0">EV {formatChaos(ev)}</span>
          </div>
          <div className="space-y-1">
            {cat.scarabs.map((s) => {
              const wOverride = state.weightOverrides[s.id]
              const pOverride = state.priceOverrides[s.id]
              const market = prices[s.name]
              return (
                <div key={s.id} className="grid grid-cols-[1fr_64px_72px] gap-1.5 items-center text-[10px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ScarabIcon name={s.name} size={16} />
                    <span className="truncate text-text-dim" title={s.name}>
                      {shortenScarabName(s.name)}
                    </span>
                  </div>
                  <input
                    className={`px-1.5 py-0.5 rounded border bg-black/30 text-text text-right ${
                      wOverride !== undefined ? 'border-accent' : 'border-white/10'
                    }`}
                    value={wOverride !== undefined ? wOverride : s.weight}
                    title={`Base ${s.weight}, effective ${Math.round(getEffectiveWeight(s, state))}`}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value)
                      onSetWeight(s.id, Number.isFinite(n) && n >= 0 ? n : null)
                    }}
                  />
                  <input
                    className={`px-1.5 py-0.5 rounded border bg-black/30 text-text text-right ${
                      pOverride !== undefined ? 'border-amber-400' : 'border-white/10'
                    }`}
                    value={pOverride !== undefined ? pOverride : market != null ? Math.round(market * 100) / 100 : ''}
                    placeholder={market != null ? String(Math.round(market * 100) / 100) : ''}
                    title={market != null ? `Market ${formatChaos(market)}` : 'No market price'}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value)
                      onSetPrice(s.id, Number.isFinite(n) && n >= 0 ? n : null)
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
