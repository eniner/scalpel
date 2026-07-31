import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useEffect, useState } from 'react'
import catalogJson from './data/tools-catalog.json'
import { divineRate, indexPrices, mirrorRateDiv } from './shared/prices'
import { ToolIcon } from './shared/ToolChrome'
import { accentBtnStyle, btnStyle, theme } from './shared/theme'
import { BetrayalTool } from './tools/BetrayalTool'
import { BeastsTool } from './tools/BeastsTool'
import { BossProfitTool } from './tools/BossProfitTool'
import { CurrencyTrendsTool } from './tools/CurrencyTrendsTool'
import { EssencesTool } from './tools/EssencesTool'
import { GemLevelingTool } from './tools/GemLevelingTool'
import { HarvestTool } from './tools/HarvestTool'
import { NightmareTool } from './tools/NightmareTool'
import { ScarabTool } from './tools/ScarabTool'
import { ScryingTool } from './tools/ScryingTool'
import { TransfigTool } from './tools/TransfigTool'

type ToolEntry = {
  id: string
  title: string
  actions: string[]
  status: 'ready' | 'stub'
}

const CATALOG = catalogJson as ToolEntry[]

type Route =
  | { kind: 'hub' }
  | { kind: 'tool'; toolId: string; action: string }

export function AdvisorPanel({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const [route, setRoute] = useState<Route>({ kind: 'hub' })
  const [rates, setRates] = useState({ cpd: 180, mirrorDiv: 380 })
  const [status, setStatus] = useState('')

  const back = () => setRoute({ kind: 'hub' })

  const refreshRates = async () => {
    try {
      await ctx.prices.refresh()
      const { prices } = await ctx.prices.getPrices()
      const byName = indexPrices(prices)
      setRates({ cpd: divineRate(byName), mirrorDiv: mirrorRateDiv(byName) })
      setStatus(`League ${ctx.getLeague()}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refreshRates()
  }, [])

  if (route.kind === 'tool') {
    const tool = CATALOG.find((t) => t.id === route.toolId)
    if (!tool) {
      return (
        <div style={{ padding: 12, color: theme.text }}>
          Unknown tool.{' '}
          <button type="button" style={btnStyle} onClick={back}>
            Back
          </button>
        </div>
      )
    }

    switch (tool.id) {
      case 'gem-leveling':
        return <GemLevelingTool ctx={ctx} onBack={back} />
      case 'gem-transfig':
        return <TransfigTool ctx={ctx} onBack={back} />
      case 'beasts':
        return <BeastsTool ctx={ctx} onBack={back} />
      case 'scarab-atlas':
        return (
          <ScarabTool
            ctx={ctx}
            onBack={back}
            view={route.action === 'Vendor Guide' ? 'vendor' : 'farming'}
          />
        )
      case 'essences':
        return <EssencesTool ctx={ctx} onBack={back} />
      case 'harvest':
        return (
          <HarvestTool
            ctx={ctx}
            onBack={back}
            initialMode={route.action === 'Crop Rotation' ? 'crop' : 'farming'}
          />
        )
      case 'currency-trends':
        return <CurrencyTrendsTool ctx={ctx} onBack={back} />
      case 'boss-profit':
        return <BossProfitTool ctx={ctx} onBack={back} />
      case 'nightmare':
        return <NightmareTool ctx={ctx} onBack={back} />
      case 'betrayal':
        return <BetrayalTool ctx={ctx} onBack={back} />
      case 'scrying':
        return <ScryingTool ctx={ctx} onBack={back} />
      default:
        return (
          <div style={{ padding: 12, color: theme.text }}>
            Unknown tool.{' '}
            <button type="button" style={btnStyle} onClick={back}>
              Back
            </button>
          </div>
        )
    }
  }

  return (
    <div
      style={{
        boxSizing: 'border-box',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        background: theme.bg,
        color: theme.text,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: theme.accent,
              borderBottom: `2px solid ${theme.accent}`,
              display: 'inline-block',
              paddingBottom: 2,
            }}
          >
            Tools
          </div>
          <div style={{ color: theme.dim, fontSize: 11, marginTop: 4 }}>Scalpel Advisor · E9</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: theme.dim }}>
          <span>{status || ctx.getLeague()}</span>
          <span>Div {Math.round(rates.cpd)} c</span>
          <span>Mirror {Math.round(rates.mirrorDiv)} d</span>
          <button type="button" style={accentBtnStyle} onClick={() => void refreshRates()}>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
        }}
      >
        {CATALOG.map((tool) => (
          <div
            key={tool.id}
            style={{
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: '12px 14px',
              display: 'flex',
              gap: 12,
              alignItems: 'stretch',
              minHeight: 88,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 48,
                flexShrink: 0,
              }}
            >
              <ToolIcon toolId={tool.id} size={40} />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                flex: 1,
                minWidth: 0,
              }}
            >
              <strong style={{ fontSize: 13 }}>{tool.title}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto' }}>
                {tool.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    style={btnStyle}
                    onClick={() => setRoute({ kind: 'tool', toolId: tool.id, action })}
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
