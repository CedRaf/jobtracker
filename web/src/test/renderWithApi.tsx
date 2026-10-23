import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { ApiContext } from '../data/hooks'
import { createDemoApi } from '../data/demoApi'

/** Renders a page on a fresh copy of the demo data. Returns that data's API to inspect saves. */
export function renderWithApi(page: ReactNode) {
  const api = createDemoApi()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>
        <MemoryRouter><AntApp>{page}</AntApp></MemoryRouter>
      </QueryClientProvider>
    </ApiContext.Provider>,
  )
  return api
}
