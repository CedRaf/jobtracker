import { expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDemoApi } from '../data/demoApi'
import { renderWithApi } from '../test/renderWithApi'
import { AnalyticsPage } from './AnalyticsPage'

it('shows the scraper health, counting the failed and interrupted demo runs', async () => {
  renderWithApi(<AnalyticsPage />)
  expect(await screen.findByText('Scraper health')).toBeInTheDocument()
  // 28 demo runs: one failed, one interrupted.
  expect(await screen.findByText(/^93%/)).toHaveTextContent('93% of 28 runs')
  await userEvent.click(screen.getByRole('button', { name: /All runs/ }))
  const health = screen.getByText('Scraper health').closest('.ant-card') as HTMLElement
  expect(await within(health).findAllByRole('row')).toHaveLength(11) // header + 10 per page
})

it('shows the headline numbers and can show a chart as a table', async () => {
  renderWithApi(<AnalyticsPage />)
  expect((await screen.findAllByText('Response rate')).length).toBeGreaterThan(0)
  expect(screen.getByText('Application funnel')).toBeInTheDocument()

  const [tableToggle] = screen.getAllByText('Table')
  await userEvent.click(tableToggle)
  expect(await screen.findByRole('columnheader', { name: 'Jobs' })).toBeInTheDocument()
})

it('shows when the next run is due and why the scheduler couldn’t start the last one', async () => {
  const api = createDemoApi()
  api.listDispatches = async () => [{
    slot: new Date(Date.now() - 3_600_000).toISOString(), sources: ['jobstreet'], status_code: 401,
    error: '{"message":"Bad credentials"}', created_at: new Date(Date.now() - 3_600_000).toISOString(),
  }]
  renderWithApi(<AnalyticsPage />, api)
  expect(await screen.findByText('Next run')).toBeInTheDocument()
  expect(screen.getByText(/^(11|15):00$/)).toBeInTheDocument()
  expect(await screen.findByText(/The scheduler couldn.t start the \d\d:\d\d run/)).toBeInTheDocument()
  expect(screen.getByText(/Bad credentials/)).toBeInTheDocument()
})

it('breaks responses down by each field, with sample sizes and thin groups marked', async () => {
  renderWithApi(<AnalyticsPage />)
  expect(await screen.findByText('What gets responses')).toBeInTheDocument()
  const card = screen.getByText('What gets responses').closest('.ant-card') as HTMLElement
  expect(within(card).getByText('Job board')).toBeInTheDocument()
  expect(within(card).getByText('All applications')).toBeInTheDocument()
  expect(within(card).getAllByText('Not enough data').length).toBeGreaterThan(0)

  await userEvent.click(within(card).getByText('Resume'))
  expect(await within(card).findByRole('columnheader', { name: 'Resume' })).toBeInTheDocument()
  expect(await within(card).findByText('AI')).toBeInTheDocument()
})

it('shows how many exams and interviews led further', async () => {
  renderWithApi(<AnalyticsPage />, createDemoApi())
  const title = await screen.findByText('After an exam or interview')
  const card = title.closest('.ant-card') as HTMLElement
  expect(within(card).getByRole('columnheader', { name: 'Went further' })).toBeInTheDocument()
  expect(within(card).getAllByRole('row')).toHaveLength(3) // header + exam + interview
})
