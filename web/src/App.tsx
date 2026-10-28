import { useState } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { App as AntApp, ConfigProvider, Grid, Result } from 'antd'
import { api, persistsCache } from './data/api'
import { createQueryClient, persistOptions } from './data/queryCache'
import { AuthProvider } from './data/auth'
import { ApiContext } from './data/hooks'
import { AuthGate } from './components/AuthGate'
import { AppLayout } from './components/AppLayout'
import { JobsPage } from './pages/JobsPage'
import { FilteredPage } from './pages/FilteredPage'
import { BoardPage } from './pages/BoardPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { GlobalStyles } from './components/GlobalStyles'
import { LastVisitContext, startVisit, useTrackVisit } from './lib/lastVisit'
import { ThemeModeContext, ThemeToggleContext, themeConfig, useThemeMode } from './lib/theme'

const queryClient = createQueryClient()

/** localStorage, or undefined where it's missing or blocked (the cache then just isn't saved). */
function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Keeps fetched data between visits (see data/queryCache.ts), except in demo mode. */
function QueryProvider({ children }: { children: React.ReactNode }) {
  if (!persistsCache) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions(browserStorage())}>
      {children}
    </PersistQueryClientProvider>
  )
}

// A data router, so pages can block navigation (the Rules page guards unsaved edits).
const router = createBrowserRouter([
  {
    element: <AuthGate><AppLayout /></AuthGate>,
    children: [
      { index: true, element: <JobsPage /> },
      { path: 'board', element: <BoardPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'filtered', element: <FilteredPage /> },
      { path: 'rules', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  const { mode, toggle } = useThemeMode()
  const [lastVisit] = useState(() => startVisit(typeof localStorage === 'undefined' ? undefined : localStorage))
  useTrackVisit()
  const screens = Grid.useBreakpoint()

  return (
    <ConfigProvider theme={themeConfig(mode)}>
     <ThemeModeContext.Provider value={mode}>
     <ThemeToggleContext.Provider value={toggle}>
      <GlobalStyles />
      {/* Phones show messages (Saved · Undo) just above the tab bar, within thumb reach. */}
      <AntApp message={{ top: screens.sm ? 8 : 'calc(100dvh - 136px)' }}>
        {api ? (
          <ApiContext.Provider value={api}>
            <QueryProvider>
              <AuthProvider>
                <LastVisitContext.Provider value={lastVisit}>
                  <RouterProvider router={router} />
                </LastVisitContext.Provider>
              </AuthProvider>
            </QueryProvider>
          </ApiContext.Provider>
        ) : (
          <Result
            status="warning"
            title="Supabase isn't configured"
            subTitle="Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see web/.env.example), or VITE_DEMO=true to use sample data."
          />
        )}
      </AntApp>
     </ThemeToggleContext.Provider>
     </ThemeModeContext.Provider>
    </ConfigProvider>
  )
}
