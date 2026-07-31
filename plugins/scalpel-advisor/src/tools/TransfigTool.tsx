import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import transfigRefJson from '../data/transfig-ref.json'
import {
  computeDivineFont,
  DEFAULT_FONTS_PER_LAB,
  DEFAULT_TIME_PER_LAB_SEC,
  type GemColor,
  type TransfigData,
} from '../engines/transfig'
import { indexPriceIcons } from '../shared/icons'
import { ItemName } from '../shared/ItemName'
import { ledgerGet, leagueDataPath } from '../shared/ledger'
import { chaosForName, fmtChaos, fmtSignedChaos, indexPrices } from '../shared/prices'
import { ToolHeader } from '../shared/ToolChrome'
import { accentBtnStyle, btnStyle, inputStyle, theme } from '../shared/theme'

const REF = transfigRefJson as unknown as TransfigData

const COLOR_HEX: Record<GemColor, string> = { red: theme.red, green: theme.green, blue: theme.blue }
const COLOR_LABEL: Record<GemColor, string> = { red: 'Red (Str)', green: 'Green (Dex)', blue: 'Blue (Int)' }

export function TransfigTool({
  ctx,
  onBack,
}: {
  ctx: ScalpelPluginContext
  onBack: () => void
}): JSX.Element {
  const [data, setData] = useState<TransfigData>(REF)
  const [cpd, setCpd] = useState(180)
  const [status, setStatus] = useState('')
  const [priceIcons, setPriceIcons] = useState<Map<string, string>>(() => new Map())

  const [l20, setL20] = useState(false)
  const [minVolume, setMinVolume] = useState(0)
  const [fontsPerLab, setFontsPerLab] = useState(DEFAULT_FONTS_PER_LAB)
  const [timePerLabSec, setTimePerLabSec] = useState(DEFAULT_TIME_PER_LAB_SEC)

  const league = ctx.getLeague()

  const refresh = useCallback(async () => {
    setStatus('Fetching prices…')
    try {
      await ctx.prices.refresh()
      const { prices: list } = await ctx.prices.getPrices()
      const byName = indexPrices(list)
      setPriceIcons(indexPriceIcons(list))
      setCpd(chaosForName(byName, 'Divine Orb') ?? 180)

      try {
        const live = await ledgerGet<TransfigData>(leagueDataPath(league, 'transfigured-gem-ev.json'))
        setData(live)
        setStatus(`Live · ${league} · ${live.bases.length} bases`)
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

  const result = useMemo(
    () => computeDivineFont(data, { l20, cpd, minVolume, fontsPerLab, timePerLabSec }),
    [data, l20, cpd, minVolume, fontsPerLab, timePerLabSec],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', overflow: 'hidden' }}>
      <ToolHeader
        toolId="gem-transfig"
        title="Gem Transfig — Divine Font EV"
        onBack={onBack}
        status={status}
        onRefresh={() => void refresh()}
        refreshLabel="Refresh"
      />
      <p style={{ margin: 0, color: theme.dim, fontSize: 11 }}>
        Divine Font blends a 2.5% chance at a random exceptional gem, 6% at your best base+variant combo, and 91.5%
        at a random gem of the best color — each color/exceptional draw is the expected max of 3 random picks.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            style={!l20 ? accentBtnStyle : btnStyle}
            onClick={() => setL20(false)}
          >
            L1
          </button>
          <button type="button" style={l20 ? accentBtnStyle : btnStyle} onClick={() => setL20(true)}>
            L20
          </button>
        </div>
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
          Fonts / Lab
          <input
            style={inputStyle}
            type="number"
            step="0.1"
            value={fontsPerLab}
            onChange={(e) => setFontsPerLab(Number(e.target.value) || 0)}
          />
        </label>
        <label style={lab}>
          Time / Lab (sec)
          <input
            style={inputStyle}
            type="number"
            value={timePerLabSec}
            onChange={(e) => setTimePerLabSec(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {(Object.keys(result.colorEV) as GemColor[]).map((color) => (
          <div
            key={color}
            style={{
              background: theme.panel,
              border: `1px solid ${color === result.bestColor ? COLOR_HEX[color] : theme.border}`,
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            <div style={{ fontSize: 9, color: theme.dim, letterSpacing: '0.04em' }}>{COLOR_LABEL[color].toUpperCase()}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLOR_HEX[color] }}>
              {fmtChaos(result.colorEV[color], cpd)}
            </div>
            {color === result.bestColor ? (
              <div style={{ fontSize: 9, color: theme.accent }}>BEST COLOR</div>
            ) : null}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="EXCEPTIONAL EV" value={fmtChaos(result.exceptionalEv, cpd)} color={theme.accent} />
        <Stat
          label="BEST BASE NET EV"
          value={fmtSignedChaos(result.best?.netEv ?? 0, cpd)}
          color={theme.purple}
        />
        <Stat label="FONT EV" value={fmtChaos(result.fontEv, cpd)} color={theme.green} />
        <Stat label="EV / HOUR" value={fmtSignedChaos(result.evPerHour, cpd)} color={theme.green} />
      </div>

      {result.best ? (
        <div style={{ fontSize: 11, color: theme.dim }}>
          Best base combo:{' '}
          <ItemName name={result.best.baseName} opts={{ priceIcons }}>
            {result.best.baseName}
          </ItemName>{' '}
          →{' '}
          <ItemName name={result.best.variantName} opts={{ priceIcons }}>
            {result.best.variantName}
          </ItemName>{' '}
          ({fmtChaos(result.best.grossPrice, cpd)} sell − {fmtChaos(result.best.baseCost, cpd)} base cost)
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        <Stat label="FONTS / LAB" value={fontsPerLab.toFixed(1)} />
        <Stat label="EV / LAB" value={fmtSignedChaos(result.evPerLab, cpd)} color={theme.blue} />
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

const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: theme.dim }
