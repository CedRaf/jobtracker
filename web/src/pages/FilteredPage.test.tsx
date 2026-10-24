import { expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithApi } from '../test/renderWithApi'
import { FilteredPage } from './FilteredPage'

it('opens the linked rule, links back to the rule editor and never shows the match score', async () => {
  renderWithApi(<FilteredPage />, undefined, '/filtered?days=30&rule=low%20skill%20match')
  expect(await screen.findByText('Low skill match')).toBeInTheDocument()
  expect(screen.queryByText(/score \d/)).not.toBeInTheDocument()
  const edit = screen.getAllByRole('link', { name: /Edit rule/ })
  expect(edit.map((a) => a.getAttribute('href'))).toContain('/rules?tab=skills')
})
