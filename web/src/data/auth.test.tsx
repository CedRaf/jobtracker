import { expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createDemoApi } from './demoApi'
import { AuthProvider } from './auth'
import { ApiContext } from './hooks'
import { createQueryClient } from './queryCache'
import type { AppUser } from './types'

it('drops cached data when you sign out', async () => {
  const api = createDemoApi()
  let notify: (user: AppUser | null) => void = () => {}
  api.auth.onChange = (callback) => {
    notify = callback
    return () => {}
  }
  const client = createQueryClient()
  client.setQueryData(['jobs'], [{ title: 'Junior developer' }])

  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}><AuthProvider>app</AuthProvider></QueryClientProvider>
    </ApiContext.Provider>,
  )
  await waitFor(() => expect(client.getQueryData(['jobs'])).toBeDefined())

  act(() => notify(null))
  await waitFor(() => expect(client.getQueryData(['jobs'])).toBeUndefined())
})
