import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ApiContext } from '../data/hooks'
import { createDemoApi } from '../data/demoApi'
import type { DataApi } from '../data/types'

/** Renders a page on a fresh copy of the demo data. Returns that data's API to inspect saves. */
export function renderWithApi(page: ReactNode, api: DataApi = createDemoApi(), path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // A data router, like the app's, so pages can use useBlocker.
  const router = createMemoryRouter([{ path: '*', element: <AntApp>{page}</AntApp> }], { initialEntries: [path] })
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  )
  return api
}
