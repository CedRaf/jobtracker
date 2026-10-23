import { useContext } from 'react'
import { theme } from 'antd'
import { ThemeModeContext, type ThemeMode } from './theme'

// Validated with the dataviz skill's validate_palette.js against the card
// surfaces (#ffffff light, #131918 dark): every check passes in both modes.
const SOURCE_COLORS: Record<ThemeMode, { jobstreet: string; linkedin: string }> = {
  light: { jobstreet: '#2a78d6', linkedin: '#eb6834' },
  dark: { jobstreet: '#3987e5', linkedin: '#d95926' },
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
