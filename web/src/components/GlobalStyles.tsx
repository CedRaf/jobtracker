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
      h1, h2, h3 { text-wrap-style: balance; }
      /* The longhand: the text-wrap shorthand would also undo antd's nowrap ellipsis. */
      .ant-typography { text-wrap-style: pretty; }
      .ant-table, .tabular { font-variant-numeric: tabular-nums; }
      .ant-table-row[tabindex]:focus-visible {
        outline: 2px solid ${token.colorPrimary}; outline-offset: -2px; }
      .stat-toggle { transition: border-color 0.15s ease-out, background-color 0.15s ease-out; }
      .stat-toggle:hover { border-color: ${token.colorPrimaryBorderHover} !important; }
      .stat-toggle:focus-visible { outline: 2px solid ${token.colorPrimary}; outline-offset: 2px; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      .tab-bar-link:focus-visible { outline: 2px solid ${token.colorPrimary}; outline-offset: -4px; }
      .save-bar { position: sticky; bottom: var(--tab-bar, 0px); z-index: 10; margin: 16px -16px -16px; padding: 12px 16px; }
      .chart-subtitle { font-weight: 400; font-size: 12px; color: ${token.colorTextSecondary}; }
      .recharts-wrapper *:focus { outline: none; }
      .board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px;
        scroll-snap-type: x proximity; align-items: flex-start; }
      .board-column { flex: 1 0 236px; min-width: 0; max-width: 340px; scroll-snap-align: start; display: flex; flex-direction: column;
        max-height: calc(100vh - 200px); transition: background-color 0.15s ease-out, border-color 0.15s ease-out; }
      @media (max-width: 575px) { .board-column { flex: 0 0 82vw; } }
      .board-column-body { overflow-y: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 8px; }
      .board-card { padding: 10px 12px; transition: border-color 0.15s ease-out; }
      .board-card:hover { border-color: ${token.colorPrimaryBorderHover} !important; }
      [aria-roledescription="draggable"]:focus-visible { outline: 2px solid ${token.colorPrimary};
        outline-offset: 2px; border-radius: ${token.borderRadius}px; }
      .rule-row + .rule-row, .rule-list > :first-child + .rule-row {
        border-top: 1px solid ${token.colorBorderSecondary}; }
      .clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; overflow-wrap: anywhere; }
    `}</style>
  )
}
