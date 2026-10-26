import { expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithApi } from '../test/renderWithApi'
import { AnalyticsPage } from './AnalyticsPage'

it('shows the scraper health, counting the failed and interrupted demo runs', async () => {
  renderWithApi(<AnalyticsPage />)
  expect(await screen.findByText('Scraper health')).toBeInTheDocument()
  // 28 demo runs: one failed, one interrupted.
  expect(await screen.findByText(/^93%/)).toHaveTextContent('93% of 28 runs')
  await userEvent.click(screen.getByRole('button', { name: /All runs/ }))
  expect(await screen.findAllByRole('row')).toHaveLength(11) // header + 10 per page
})

it('shows the headline numbers and can show a chart as a table', async () => {
  renderWithApi(<AnalyticsPage />)
  expect(await screen.findByText('Response rate')).toBeInTheDocument()
  expect(screen.getByText('Application funnel')).toBeInTheDocument()

  const [tableToggle] = screen.getAllByText('Table')
  await userEvent.click(tableToggle)
  expect(await screen.findByRole('columnheader', { name: 'Jobs' })).toBeInTheDocument()
})
