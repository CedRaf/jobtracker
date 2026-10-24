import { useState } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider, Grid, Result } from 'antd'
import { api } from './data/api'
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } },
})

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
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <LastVisitContext.Provider value={lastVisit}>
                  <RouterProvider router={router} />
                </LastVisitContext.Provider>
              </AuthProvider>
            </QueryClientProvider>
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
