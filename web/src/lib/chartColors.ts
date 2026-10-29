import { useContext } from 'react'
import { theme } from 'antd'
import type { JobSource } from '../data/types'
import { ThemeModeContext, type ThemeMode } from './theme'

// Validated with the dataviz skill's validate_palette.js against the card
// surfaces (#ffffff light, #131918 dark): every check passes in both modes.
// Light aqua is 2.82:1 on white (a contrast WARN), which the chart's legend and
// table view cover.
const SOURCE_COLORS: Record<ThemeMode, Record<JobSource, string>> = {
  light: { jobstreet: '#2a78d6', linkedin: '#eb6834', himalayas: '#1baf7a' },
  dark: { jobstreet: '#3987e5', linkedin: '#d95926', himalayas: '#199e70' },
}

export const useChartColors = () => {
  const { token } = theme.useToken()
  const mode = useContext(ThemeModeContext)
  return {
    sources: SOURCE_COLORS[mode],
    single: token.colorPrimary,
    grid: token.colorBorderSecondary,
    text: token.colorTextSecondary,
    surface: token.colorBgContainer,
    token,
  }
}
