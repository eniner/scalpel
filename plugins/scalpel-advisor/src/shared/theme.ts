import type { CSSProperties } from 'react'

export const theme = {
  bg: 'var(--bg, #0c0c12)',
  panel: 'var(--panel, #16161e)',
  text: 'var(--text, #e8e6e3)',
  dim: 'var(--text-dim, #9a9690)',
  accent: 'var(--accent, #e8922a)',
  border: 'var(--border, #2a2a32)',
  green: '#5dba6f',
  red: '#d46464',
  blue: '#6aa8e0',
  purple: '#a78bfa',
} as const

export const inputStyle: CSSProperties = {
  background: '#121218',
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  color: theme.text,
  padding: '4px 6px',
  fontSize: 12,
  width: 72,
}

export const btnStyle: CSSProperties = {
  background: '#1c1c26',
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  color: theme.text,
  padding: '5px 10px',
  fontSize: 11,
  cursor: 'pointer',
}

export const accentBtnStyle: CSSProperties = {
  ...btnStyle,
  background: theme.accent,
  borderColor: theme.accent,
  color: '#111',
  fontWeight: 600,
}
