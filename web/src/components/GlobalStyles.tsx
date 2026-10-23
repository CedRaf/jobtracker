import { theme } from 'antd'

/**
 * The browser surfaces antd doesn't style (selection, focus on non-antd
 * elements, scrollbars, numerals), drawn from the current theme's tokens.
 */
export function GlobalStyles() {
  const { token } = theme.useToken()
  return (
    <style>{`
      body { margin: 0; background: ${token.colorBgLayout}; }
      ::selection { background: ${token.colorPrimaryBgHover}; color: ${token.colorText}; }
      html { accent-color: ${token.colorPrimary}; caret-color: ${token.colorPrimary};
        scrollbar-color: ${token.colorBorder} transparent; }
      h1, h2, h3 { text-wrap: balance; }
      .ant-typography { text-wrap: pretty; }
      .ant-table, .tabular { font-variant-numeric: tabular-nums; }
      .ant-table-row[tabindex]:focus-visible {
        outline: 2px solid ${token.colorPrimary}; outline-offset: -2px; }
      .stat-toggle { transition: border-color 0.15s ease-out, background-color 0.15s ease-out; }
      .stat-toggle:hover { border-color: ${token.colorPrimaryBorderHover} !important; }
      .stat-toggle:focus-visible { outline: 2px solid ${token.colorPrimary}; outline-offset: 2px; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; overflow-wrap: anywhere; }
    `}</style>
  )
}
