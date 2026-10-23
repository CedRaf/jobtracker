import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider, Result, theme } from 'antd'
import { api } from './data/api'
import { AuthProvider } from './data/auth'
import { ApiContext } from './data/hooks'
import { AuthGate } from './components/AuthGate'
import { AppLayout } from './components/AppLayout'
import { JobsPage } from './pages/JobsPage'
import { FilteredPage } from './pages/FilteredPage'
import { LastVisitContext, startVisit } from './lib/lastVisit'
import { useThemeMode } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } },
})

export default function App() {
  const { mode, toggle } = useThemeMode()
  const [lastVisit] = useState(() => startVisit(typeof localStorage === 'undefined' ? undefined : localStorage))

  return (
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif",
          ...(mode === 'light' && { colorBgLayout: '#f5f6fa' }),
        },
        components: {
          Table: { headerBg: 'transparent' },
        },
      }}
    >
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
                          <Route path="filtered" element={<FilteredPage />} />
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
    </ConfigProvider>
  )
}
