import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import scarabsRefJson from '../data/scarabs-ref.json'
import {
  buildVendorGuide,
  computeOptimalStrategy,
  computeScarabPool,
  VENDOR_CATEGORY_ORDER,
  type Scarab,
  type ScarabsRef,
} from '../engines/scarab'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { chaosForId, chaosForName, fmtChaos, idToName, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { accentBtnStyle, btnStyle, inputStyle, theme } from '../shared/theme'

const REF = scarabsRefJson as ScarabsRef

export function ScarabTool({
  ctx,
  onBack,
  view = 'farming',
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
  view?: 'farming' | 'vendor'
}): JSX.Element {
  const [tab, setTab] = useState<'farming' | 'vendor'>(view)
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({})
  const [remarkableRelics, setRemarkableRelics] = useState(true)
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [boosted, setBoosted] = useState<Set<string>>(new Set())
  const [invested, setInvested] = useState<Set<string>>(new Set())
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  useEffect(() => setTab(view), [view])

  const priceFor = useCallback((scarab: Scarab): number | null => prices[scarab.id] ?? null, [prices])

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)

      const next: Record<string, number | null> = {}
      for (const cat of REF.categories) {
        for (const s of cat.scarabs) {
          next[s.id] = chaosForId(byName, s.id) ?? chaosForName(byName, s.name)
        }
      }
      setPrices(next)
      setStatus(`Prices · ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pool = useMemo(
    () =>
      computeScarabPool({
        categories: REF.categories,
        priceFor,
        priceOverrides,
        remarkableRelics,
        blocked,
        boosted,
        invested,
      }),
    [priceFor, priceOverrides, remarkableRelics, blocked, boosted, invested],
  )

  const optimal = useMemo(
    () =>
      computeOptimalStrategy({
        categories: REF.categories,
        priceFor,
        priceOverrides,
        remarkableRelics,
      }),
    [priceFor, priceOverrides, remarkableRelics],
  )

  const vendorGuide = useMemo(
    () => buildVendorGuide({ categories: REF.categories, priceFor, priceOverrides }),
    [priceFor, priceOverrides],
  )

  const applyOptimal = () => {
    setBlocked(new Set(optimal.blocks))
    setBoosted(new Set(optimal.boosts))
    setInvested(new Set(optimal.investments))
  }

  const resetBiases = () => {
    setBlocked(new Set())
    setBoosted(new Set())
    setInvested(new Set())
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  const sortedCategories = useMemo(
    () =>
      [...pool.categories].sort(
        (a, b) => VENDOR_CATEGORY_ORDER.indexOf(a.category.id) - VENDOR_CATEGORY_ORDER.indexOf(b.category.id),
      ),
    [pool.categories],
  )

  const vendorByCategory = useMemo(() => {
    const map = new Map<string, typeof vendorGuide.rows>()
    for (const row of vendorGuide.rows) {
      const list = map.get(row.category.id) ?? []
      list.push(row)
      map.set(row.category.id, list)
    }
    return map
  }, [vendorGuide.rows])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="scarab-atlas"
        title="Scarab Atlas"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          style={tab === 'farming' ? accentBtnStyle : btnStyle}
          onClick={() => setTab('farming')}
        >
          Farming EV
        </button>
        <button type="button" style={tab === 'vendor' ? accentBtnStyle : btnStyle} onClick={() => setTab('vendor')}>
          Vendor Guide
        </button>
      </div>

      {tab === 'farming' ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="checkbox"
                checked={remarkableRelics}
                onChange={(e) => setRemarkableRelics(e.target.checked)}
              />
              Remarkable Relics (weight^0.9)
            </label>
            <button type="button" style={btnStyle} onClick={resetBiases}>
              Reset
            </button>
            <button type="button" style={accentBtnStyle} onClick={applyOptimal}>
              Optimize
            </button>
            <span style={{ color: theme.dim, fontSize: 10 }}>
              Click a category to block (blockable) or invest (1.5x) — boostable categories cycle block → invest.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            <Stat label="BASELINE EV" value={fmtChaos(pool.baselineEV, cpd)} />
            <Stat label="CURRENT POOL EV" value={fmtChaos(pool.poolEV, cpd)} color={theme.accent} />
            <Stat label="OPTIMAL EV" value={fmtChaos(optimal.ev, cpd)} color={theme.green} />
            <Stat label="BLOCKS / BOOSTS / INVESTS" value={`${optimal.blocks.length} / ${optimal.boosts.length} / ${optimal.investments.length}`} />
          </div>

          <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: theme.dim, textAlign: 'left' }}>
                  <th style={th}>CATEGORY</th>
                  <th style={th}>MODIFIER</th>
                  <th style={th}>CAT EV</th>
                  <th style={th}>MULT</th>
                  <th style={th}>BLOCK</th>
                  <th style={th}>BOOST 2x</th>
                  <th style={th}>INVEST 1.5x</th>
                </tr>
              </thead>
              <tbody>
                {sortedCategories.map(({ category, ev, multiplier, blocked: isBlocked }) => (
                  <tr key={category.id} style={{ borderTop: `1px solid ${theme.border}`, opacity: isBlocked ? 0.5 : 1 }}>
                    <td style={td}>{category.name}</td>
                    <td style={{ ...td, color: theme.dim, fontSize: 10 }}>{category.atlasModifier}</td>
                    <td style={{ ...td, color: theme.purple }}>{fmtChaos(ev, cpd)}</td>
                    <td style={td}>{multiplier.toFixed(2)}x</td>
                    <td style={td}>
                      {category.atlasModifier === 'blockable' ? (
                        <input
                          type="checkbox"
                          checked={blocked.has(category.id)}
                          onChange={() => toggle(blocked, setBlocked, category.id)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={td}>
                      {category.atlasModifier === 'boostable' ? (
                        <input
                          type="checkbox"
                          checked={boosted.has(category.id)}
                          onChange={() => toggle(boosted, setBoosted, category.id)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={td}>
                      {category.investmentBoost ? (
                        <input
                          type="checkbox"
                          checked={invested.has(category.id)}
                          onChange={() => toggle(invested, setInvested, category.id)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            <strong>Vendor Recipe:</strong> Sell any 3 scarabs → 1 random scarab worth{' '}
            <span style={{ color: theme.purple }}>{fmtChaos(vendorGuide.rawBaselineEV, cpd)}</span>. Scarabs priced
            below <span style={{ color: theme.accent }}>{fmtChaos(vendorGuide.vendorThreshold, cpd)}</span> are
            profitable to vendor.
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              readOnly
              style={{ ...inputStyle, width: 420, fontFamily: 'monospace' }}
              value={vendorGuide.searchString}
              onFocus={(e) => e.currentTarget.select()}
            />
            <span style={{ color: theme.dim, fontSize: 11 }}>
              {vendorGuide.includedCount}/{vendorGuide.totalVendorable} scarabs, {vendorGuide.searchString.length}/248
              chars
              {vendorGuide.missingSignatureCount > 0 ? ` · ${vendorGuide.missingSignatureCount} missing signature` : ''}
            </span>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {[...REF.categories]
                .sort((a, b) => VENDOR_CATEGORY_ORDER.indexOf(a.id) - VENDOR_CATEGORY_ORDER.indexOf(b.id))
                .map((cat) => {
                  const rows = vendorByCategory.get(cat.id) ?? []
                  return (
                    <div
                      key={cat.id}
                      style={{
                        background: theme.panel,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 6,
                        padding: '8px 10px',
                        opacity: rows.length === 0 ? 0.4 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600 }}>
                        <span>{cat.name}</span>
                        <span style={{ color: theme.dim }}>
                          {rows.length}/{cat.scarabs.length}
                        </span>
                      </div>
                      {rows.map((row) => (
                        <div
                          key={row.scarab.id}
                          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}
                        >
                          <ItemName
                            name={row.scarab.name}
                            opts={{ priceIcons, aliases: [idToName(row.scarab.id)] }}
                            style={{ color: theme.dim }}
                          >
                            {row.scarab.name.replace(/Scarab of /i, '').replace(/ Scarab$/i, '')}
                          </ItemName>
                          <span>{fmtChaos(row.price, cpd)}</span>
                          <span style={{ color: theme.green }}>+{fmtChaos(row.profit, cpd)}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
            </div>
          </div>
        </>
      )}
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
