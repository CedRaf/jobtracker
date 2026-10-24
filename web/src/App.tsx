import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider, Result } from 'antd'
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
import { ThemeModeContext, themeConfig, useThemeMode } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } },
})

export default function App() {
  const { mode, toggle } = useThemeMode()
  const [lastVisit] = useState(() => startVisit(typeof localStorage === 'undefined' ? undefined : localStorage))
  useTrackVisit()

  return (
    <ConfigProvider theme={themeConfig(mode)}>
     <ThemeModeContext.Provider value={mode}>
      <GlobalStyles />
      <AntApp>
        {api ? (
          <ApiContext.Provider value={api}>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <LastVisitContext.Provider value={lastVisit}>
                  <BrowserRouter>
                    <AuthGate>
                      <Routes>
                        <Route element={<AppLayout themeMode={mode} onToggleTheme={toggle} />}>
                          <Route index element={<JobsPage />} />
                          <Route path="board" element={<BoardPage />} />
                          <Route path="analytics" element={<AnalyticsPage />} />
                          <Route path="filtered" element={<FilteredPage />} />
                          <Route path="rules" element={<SettingsPage />} />
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Route>
                      </Routes>
                    </AuthGate>
                  </BrowserRouter>
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
     </ThemeModeContext.Provider>
    </ConfigProvider>
  )
}
