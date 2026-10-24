import { createContext, useEffect, useState } from 'react'
import { theme, type ThemeConfig } from 'antd'

export type ThemeMode = 'light' | 'dark'

/** The current mode, for the few things antd tokens don't cover (chart colours). */
export const ThemeModeContext = createContext<ThemeMode>('light')
/** Switches between light and dark; provided next to ThemeModeContext. */
export const ThemeToggleContext = createContext<() => void>(() => {})

const KEY = 'jobtracker.theme'

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // storage unavailable: fall through to the system setting
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Light/dark mode: follows the system until you pick one, then remembers it. */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(initialMode)
  useEffect(() => {
    document.documentElement.style.colorScheme = mode
  }, [mode])
  const toggle = () =>
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // not remembered, but still switches
      }
      return next
    })
  return { mode, toggle }
}

const FONT = "'Public Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

// Teal is the review colour: the primary action, "new" and the current filter.
// Dark mode gets a lighter teal so it reads as text on dark surfaces, and
// primary buttons switch to dark ink on it. Neutrals carry a trace of the teal.
// Secondary and placeholder text are darker than antd's defaults to pass WCAG AA.
const TOKENS: Record<ThemeMode, ThemeConfig['token']> = {
  light: {
    colorPrimary: '#0f766e',
    colorInfo: '#0f766e',
    // antd derives these from the seed as if it were a mid tone; this teal is
    // darker, so its generated tints come out grey. Set them by hand.
    colorPrimaryBg: '#e8f5f3',
    colorPrimaryBgHover: '#d3ece8',
    colorPrimaryBorder: '#a7d8d0',
    colorPrimaryBorderHover: '#79c4b8',
    colorPrimaryHover: '#138a80',
    colorPrimaryActive: '#0b5f58',
    colorPrimaryTextHover: '#138a80',
    colorPrimaryTextActive: '#0b5f58',
    colorInfoBg: '#e8f5f3',
    colorInfoBorder: '#a7d8d0',
    colorBgLayout: '#f2f5f5',
    colorTextSecondary: 'rgba(0, 0, 0, 0.64)',
    colorTextTertiary: 'rgba(0, 0, 0, 0.56)',
    colorTextPlaceholder: 'rgba(0, 0, 0, 0.56)',
  },
  dark: {
    colorPrimary: '#2bb8ad',
    colorInfo: '#2bb8ad',
    colorBgLayout: '#0b0f0f',
    colorBgContainer: '#131918',
    colorBgElevated: '#1b2221',
    colorTextSecondary: 'rgba(255, 255, 255, 0.7)',
    colorTextTertiary: 'rgba(255, 255, 255, 0.58)',
    colorTextPlaceholder: 'rgba(255, 255, 255, 0.52)',
  },
}

export function themeConfig(mode: ThemeMode): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      fontFamily: FONT,
      borderRadius: 6,
      fontSizeHeading1: 24,
      lineHeightHeading1: 1.25,
      ...TOKENS[mode],
    },
    components: {
      Table: { headerBg: 'transparent' },
      ...(mode === 'dark' && { Button: { primaryColor: '#04201d' } }),
    },
  }
}
