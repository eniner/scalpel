import { renderToStaticMarkup } from 'react-dom/server'

export const ADVISOR_ICON = renderToStaticMarkup(
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
    <path d="M24 8v32M12 16h24M14 28h20" strokeLinecap="round" />
    <circle cx="24" cy="24" r="18" opacity="0.35" />
  </svg>,
)
