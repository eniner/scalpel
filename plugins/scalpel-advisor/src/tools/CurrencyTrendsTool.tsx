import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import currencyItemsJson from '../data/currency-items-ref.json'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { ledgerGet } from '../shared/ledger'
import { chaosForName, fmtChaos, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { accentBtnStyle, btnStyle, inputStyle, theme } from '../shared/theme'

type CurrencyItem = { id: string; name: string }

type CurrencyHistorySide = {
  volume: number
  lowestStock: number
  highestStock: number
  lowestRatio: number
  highestRatio: number
} | null

type CurrencyHistoryPoint = {
  recordedAt: string
  chaos: CurrencyHistorySide
  divine: CurrencyHistorySide
}

type CurrencyHistoryResponse = {
  itemId: string
  name: string
  currentChaosPrice: number | null
  currentDivinePrice: number | null
  history: CurrencyHistoryPoint[]
}

const ITEMS = currencyItemsJson as CurrencyItem[]
const DAYS_OPTIONS = [1, 3, 7] as const

function pointPrice(p: CurrencyHistoryPoint): number | null {
  if (!p.chaos) return null
  return (p.chaos.lowestRatio + p.chaos.highestRatio) / 2
}

function leagueIdFor(league: string): string {
  return league.toLowerCase().replace(/\s+/g, '-')
}

export function CurrencyTrendsTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceByName, setPriceByName] = useState<Map<string, number>>(new Map())
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CurrencyItem | null>(null)
  const [days, setDays] = useState<1 | 3 | 7>(3)
  const [history, setHistory] = useState<CurrencyHistoryResponse | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const league = ctx.getLeague()

  const refreshPrices = useCallback(async () => {
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
          next.set(e.name.toLowerCase(), e.chaosValue)
        }
      }
      setPriceByName(next)
      setStatus(`Prices · ${league}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [ctx, league])

  useEffect(() => {
    void refreshPrices()
  }, [refreshPrices])

  const loadHistory = useCallback(
    async (item: CurrencyItem, d: 1 | 3 | 7) => {
      setLoadingHistory(true)
      setHistoryError(null)
      try {
        const leagueId = leagueIdFor(league)
        const res = await ledgerGet<CurrencyHistoryResponse>(
          `/api/${leagueId}/currency-history/${item.id}?days=${d}`,
        )
        setHistory(res)
      } catch (err) {
        setHistory(null)
        setHistoryError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingHistory(false)
      }
    },
    [league],
  )

  const selectItem = (item: CurrencyItem) => {
    setSelected(item)
    void loadHistory(item, days)
  }

  const changeDays = (d: 1 | 3 | 7) => {
    setDays(d)
    if (selected) void loadHistory(selected, d)
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ITEMS.slice(0, 60)
    return ITEMS.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 60)
  }, [search])

  const livePrice = selected ? priceByName.get(selected.name.toLowerCase()) ?? null : null

  const chronological = useMemo(() => {
    if (!history) return []
    return [...history.history].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
  }, [history])

  const maxPrice = useMemo(() => {
    let max = 0
    for (const p of chronological) {
      const v = pointPrice(p)
      if (v != null && v > max) max = v
    }
    return max
  }, [chronological])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="currency-trends"
        title="Currency Trends"
        onBack={onBack}
        status={status}
        onRefresh={() => void refreshPrices()}
        refreshLabel="Refresh"
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Search any tracked currency/item and pull its recent price history from the Perandus Ledger.
      </p>

      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            style={{ ...inputStyle, width: '100%' }}
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6, padding: 4 }}>
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectItem(item)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: selected?.id === item.id ? '#1e1a14' : 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 8px',
                  cursor: 'pointer',
                  color: selected?.id === item.id ? theme.accent : theme.text,
                  fontSize: 12,
                }}
              >
                <ItemName name={item.name} opts={{ priceIcons }}>
                  {item.name}
                </ItemName>
              </button>
            ))}
            {filteredItems.length === 0 ? (
              <div style={{ color: theme.dim, fontSize: 11, padding: 8 }}>No matches</div>
            ) : null}
          </div>
          <div style={{ color: theme.dim, fontSize: 10 }}>{ITEMS.length} items total</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6, padding: 10 }}>
          {!selected ? (
            <div style={{ color: theme.dim, fontSize: 12 }}>Select an item to view its price history.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ fontSize: 15 }}>
                  <ItemName name={selected.name} opts={{ priceIcons }} size={18}>
                    {selected.name}
                  </ItemName>
                </strong>
                <div style={{ display: 'flex', gap: 4 }}>
                  {DAYS_OPTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      style={days === d ? accentBtnStyle : btnStyle}
                      onClick={() => changeDays(d)}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
                <span>
                  Live price (ctx.prices):{' '}
                  <strong style={{ color: livePrice != null ? theme.green : theme.dim }}>
                    {livePrice != null ? fmtChaos(livePrice, cpd) : 'not found'}
                  </strong>
                </span>
                {history?.currentChaosPrice != null ? (
                  <span>
                    Ledger price: <strong style={{ color: theme.blue }}>{fmtChaos(history.currentChaosPrice, cpd)}</strong>
                  </span>
                ) : null}
              </div>

              {loadingHistory ? (
                <div style={{ color: theme.dim, fontSize: 12, marginTop: 10 }}>Loading history…</div>
              ) : historyError ? (
                <div
                  style={{
                    marginTop: 10,
                    background: '#331a1a',
                    border: '1px solid #6a2a2a',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: theme.red,
                  }}
                >
                  Failed to load history: {historyError}
                </div>
              ) : chronological.length === 0 ? (
                <div style={{ color: theme.dim, fontSize: 12, marginTop: 10 }}>No history data for this item.</div>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 1,
                      height: 80,
                      marginTop: 12,
                      borderBottom: `1px solid ${theme.border}`,
                    }}
                  >
                    {chronological.map((p, i) => {
                      const price = pointPrice(p)
                      const heightPct = price != null && maxPrice > 0 ? Math.max((price / maxPrice) * 100, 2) : 0
                      return (
                        <div
                          key={i}
                          title={`${new Date(p.recordedAt).toLocaleString()} — ${price != null ? fmtChaos(price, cpd) : 'n/a'}`}
                          style={{
                            flex: 1,
                            height: `${heightPct}%`,
                            background: theme.accent,
                            opacity: price != null ? 0.85 : 0.15,
                            minWidth: 1,
                          }}
                        />
                      )
                    })}
                  </div>
                  <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ color: theme.dim, textAlign: 'left' }}>
                          <th style={th}>TIME</th>
                          <th style={th}>PRICE</th>
                          <th style={th}>VOLUME</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...chronological].reverse().map((p, i) => {
                          const price = pointPrice(p)
                          return (
                            <tr key={i} style={{ borderTop: `1px solid ${theme.border}` }}>
                              <td style={td}>{new Date(p.recordedAt).toLocaleString()}</td>
                              <td style={td}>{price != null ? fmtChaos(price, cpd) : '—'}</td>
                              <td style={{ ...td, color: theme.dim }}>{p.chaos?.volume ?? 0}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const th: CSSProperties = { padding: '4px 6px', fontWeight: 500, fontSize: 10 }
const td: CSSProperties = { padding: '4px 6px' }
