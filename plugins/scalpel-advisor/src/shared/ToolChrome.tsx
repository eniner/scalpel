import type { CSSProperties, ReactNode } from 'react'
import { TOOL_ICONS } from '../shared/toolIcons'
import { accentBtnStyle, btnStyle, theme } from '../shared/theme'

export function ToolIcon({
  toolId,
  size = 28,
}: {
  toolId: string
  size?: number
}): JSX.Element | null {
  const src = TOOL_ICONS[toolId]
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        imageRendering: 'auto',
      }}
      draggable={false}
    />
  )
}

export function ToolHeader({
  toolId,
  title,
  onBack,
  status,
  onRefresh,
  refreshLabel = 'Refresh Prices',
  children,
}: {
  toolId: string
  title: string
  onBack: () => void
  status?: string
  onRefresh?: () => void
  refreshLabel?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" style={btnStyle} onClick={onBack}>
        ← Tools
      </button>
      <ToolIcon toolId={toolId} size={26} />
      <strong style={{ color: theme.accent, fontSize: 16 }}>{title}</strong>
      {status != null ? (
        <span style={{ color: theme.dim, fontSize: 11, flex: 1 }}>{status}</span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {children}
      {onRefresh ? (
        <button type="button" style={accentBtnStyle} onClick={onRefresh}>
          {refreshLabel}
        </button>
      ) : null}
    </div>
  )
}

export const toolTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}
