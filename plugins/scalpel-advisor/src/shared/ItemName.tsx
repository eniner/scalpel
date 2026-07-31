import type { CSSProperties, ReactNode } from 'react'
import { resolveItemIcon, type IconResolveOpts } from './icons'

export function ItemIcon({
  name,
  size = 20,
  opts,
  style,
}: {
  name: string
  size?: number
  opts?: IconResolveOpts
  style?: CSSProperties
}): JSX.Element | null {
  const src = resolveItemIcon(name, opts)
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
        ...style,
      }}
      draggable={false}
    />
  )
}

/** Icon + label row used in advisor tables. */
export function ItemName({
  name,
  size = 20,
  opts,
  children,
  style,
}: {
  name: string
  size?: number
  opts?: IconResolveOpts
  children?: ReactNode
  style?: CSSProperties
}): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, ...style }}>
      <ItemIcon name={name} size={size} opts={opts} />
      <span style={{ minWidth: 0 }}>{children ?? name}</span>
    </span>
  )
}
