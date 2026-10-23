import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { ApiContext } from '../data/hooks'
import { createDemoApi } from '../data/demoApi'
import { JobsPage } from './JobsPage'

function renderPage() {
  const api = createDemoApi()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>
        <AntApp><JobsPage /></AntApp>
      </QueryClientProvider>
    </ApiContext.Provider>,
  )
  return api
}

describe('JobsPage', () => {
  it('lists active jobs and hides skipped/rejected ones by default', async () => {
    renderPage()
    expect(await screen.findByText('Junior Full Stack Developer')).toBeInTheDocument()
    expect(screen.getByText('Full Stack Engineer')).toBeInTheDocument() // interview
    expect(screen.queryByText('Software Engineer Trainee')).not.toBeInTheDocument() // skip
    expect(screen.queryByText('Junior Web Developer')).not.toBeInTheDocument() // rejected
  })

  it('shows one source per tab', async () => {
    renderPage()
    await screen.findByText('Junior Full Stack Developer')
    expect(screen.queryByText('AI Engineer – Junior')).not.toBeInTheDocument() // LinkedIn

    await userEvent.click(screen.getByRole('tab', { name: /LinkedIn/ }))
    expect(await screen.findByText('AI Engineer – Junior')).toBeInTheDocument()
    expect(screen.queryByText('Junior Full Stack Developer')).not.toBeInTheDocument()
  })

  it('searches by text', async () => {
    renderPage()
    await screen.findByText('Junior Full Stack Developer')
    await userEvent.type(screen.getByPlaceholderText(/search title/i), 'harbor{Enter}')
    expect(screen.getByText('Associate Software Engineer')).toBeInTheDocument()
    expect(screen.queryByText('Junior Full Stack Developer')).not.toBeInTheDocument()
  })

  it('filters to a status from its summary card', async () => {
    renderPage()
    await screen.findByText('Junior Full Stack Developer')
    await userEvent.click(screen.getByRole('button', { name: /Interviewing/ }))
    expect(screen.getByText('Full Stack Engineer')).toBeInTheDocument()
    expect(screen.queryByText('Junior Full Stack Developer')).not.toBeInTheDocument()
  })

  it('opens the drawer with the description and saves notes', async () => {
    const api = renderPage()
    await userEvent.click(await screen.findByText('Junior Full Stack Developer'))
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText(/is hiring a Junior Full Stack Developer/)).toBeInTheDocument()

    await userEvent.type(within(drawer).getByPlaceholderText('Notes'), 'Apply this week')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved')
    const saved = (await api.listJobs()).find((j) => j.title === 'Junior Full Stack Developer')
    expect(saved?.notes).toBe('Apply this week')
  })
})
