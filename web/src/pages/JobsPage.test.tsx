import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { ApiContext } from '../data/hooks'
import { createDemoApi } from '../data/demoApi'
import type { DataApi } from '../data/types'
import { createTwoSiteApi } from '../test/twoSiteApi'
import { JobsPage } from './JobsPage'

function renderPage(api: DataApi = createDemoApi()) {
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

it('opens the email template editor with the default template', async () => {
  renderPage()
  await userEvent.click(await screen.findByText('Junior Full Stack Developer'))
  const drawer = await screen.findByRole('dialog')
  await userEvent.click(within(drawer).getByRole('button', { name: /Edit template/ }))
  expect(await screen.findByDisplayValue('Inquiry: {title} Position')).toBeInTheDocument()
})

it('marks entry-level jobs, lists them first, and can show only them', async () => {
  renderPage()
  await screen.findByText('Junior Full Stack Developer')
  const titles = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('strong')?.textContent)
  // "Associate Software Engineer" (5 hours old) beats newer non-junior titles.
  const order = titles()
  expect(order.indexOf('Associate Software Engineer')).toBeLessThan(order.indexOf('Full Stack Engineer'))
  expect(screen.getAllByText('Entry-level').length).toBeGreaterThan(0)

  await userEvent.click(screen.getByLabelText('Entry-level first'))
  expect(titles()[0]).toBe('Junior Full Stack Developer') // plain newest first

  await userEvent.click(screen.getByLabelText('Entry-level only'))
  expect(screen.queryByText('Full Stack Engineer')).not.toBeInTheDocument()
  expect(screen.getByText('Associate Software Engineer')).toBeInTheDocument()
})

describe('JobsPage', () => {
  it('lists active jobs and hides skipped/rejected ones by default', async () => {
    renderPage()
    expect(await screen.findByText('Junior Full Stack Developer')).toBeInTheDocument()
    expect(screen.getByText('Full Stack Engineer')).toBeInTheDocument() // interview
    expect(screen.queryByText('Software Engineer Trainee')).not.toBeInTheDocument() // skip
    expect(screen.queryByText('Junior Web Developer')).not.toBeInTheDocument() // rejected
  })

  it('shows no site tabs when there is only one site (the public demo)', async () => {
    renderPage()
    await screen.findByText('Junior Full Stack Developer')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText('AI Engineer – Junior')).toBeInTheDocument()
  })

  it('shows one source per tab', async () => {
    renderPage(createTwoSiteApi())
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

    await userEvent.type(within(drawer).getByLabelText('Notes'), 'Apply this week')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved')
    const saved = (await api.listJobs()).find((j) => j.title === 'Junior Full Stack Developer')
    expect(saved?.notes).toBe('Apply this week')
  })

  it('opens a job from the keyboard', async () => {
    renderPage()
    const title = await screen.findByText('Junior Full Stack Developer')
    const row = title.closest('tr')!
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('keeps a skipped job listed and asks why', async () => {
    renderPage()
    await screen.findByText('Junior Full Stack Developer')
    await userEvent.click(screen.getByRole('combobox', { name: 'Status of Junior Full Stack Developer' }))
    await userEvent.click(await screen.findByTitle('Skip'))
    expect(await screen.findByText('Why skip? (optional)')).toBeInTheDocument()
    expect(screen.getByText('Junior Full Stack Developer')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('says when there is nothing left to review', async () => {
    renderPage(createTwoSiteApi())
    await screen.findByText('Junior Full Stack Developer')
    await userEvent.click(screen.getByRole('tab', { name: /LinkedIn/ }))
    await screen.findByText('AI Engineer – Junior')
    const titles = [
      'AI Engineer – Junior', 'React Developer (Entry Level)', 'Junior React Native Developer',
      'Associate Software Engineer – Platform Integrations and Internal Tooling (Hybrid)',
    ]
    for (const title of titles) {
      await userEvent.click(screen.getByRole('combobox', { name: `Status of ${title}` }))
      await userEvent.click((await screen.findAllByTitle('Applied')).at(-1)!)
    }
    await userEvent.click(screen.getByRole('button', { name: /To review/ }))
    expect(await screen.findByText(/You're caught up/)).toBeInTheDocument()
  })
})
