import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

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
