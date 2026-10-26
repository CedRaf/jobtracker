import { expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithApi } from '../test/renderWithApi'
import { createTwoSiteApi } from '../test/twoSiteApi'
import { BoardPage } from './BoardPage'

const column = (name: RegExp) => screen.getByRole('listitem', { name })

it('puts each job in the column for its status, closed columns hidden by default', async () => {
  renderWithApi(<BoardPage />)
  expect(await screen.findByText('Full Stack Engineer')).toBeInTheDocument()
  expect(within(column(/^Interview:/)).getByText('Full Stack Engineer')).toBeInTheDocument()
  expect(within(column(/^New:/)).getByText('Junior Full Stack Developer')).toBeInTheDocument()
  expect(screen.queryByRole('listitem', { name: /^Skip:/ })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('switch'))
  expect(within(column(/^Skip:/)).getByText('Software Engineer Trainee')).toBeInTheDocument()
})

it('has no source filter when there is only one site (the public demo)', async () => {
  renderWithApi(<BoardPage />)
  await screen.findByText('Junior Full Stack Developer')
  expect(screen.queryByRole('radiogroup', { name: 'Source' })).not.toBeInTheDocument()
  expect(screen.queryByText('LinkedIn')).not.toBeInTheDocument()
})

it('filters the board by source', async () => {
  renderWithApi(<BoardPage />, createTwoSiteApi())
  await screen.findByText('Junior Full Stack Developer')
  await userEvent.click(screen.getByText('LinkedIn'))
  expect(screen.queryByText('Junior Full Stack Developer')).not.toBeInTheDocument()
  expect(screen.getByText('React Developer (Entry Level)')).toBeInTheDocument()
})

it('opens a card in the job drawer', async () => {
  renderWithApi(<BoardPage />)
  await userEvent.click(await screen.findByText('Junior Full Stack Developer'))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Lumen Labs')
})
