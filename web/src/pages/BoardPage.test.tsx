import { expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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

it('has an Exam column between Emailed and Interview', async () => {
  renderWithApi(<BoardPage />)
  await screen.findByText('Full Stack Engineer')
  const names = screen.getAllByRole('listitem').map((c) => c.getAttribute('aria-label')?.split(':')[0])
  expect(names.slice(0, 6)).toEqual(['New', 'Applied', 'Emailed', 'Exam', 'Interview', 'Offer'])
})

it('can show only the applications you logged yourself', async () => {
  const api = createTwoSiteApi()
  renderWithApi(<BoardPage />, api)
  await screen.findByText('Junior Full Stack Developer')
  await userEvent.click(screen.getByText('Logged by you'))
  expect(screen.queryByText('Junior Full Stack Developer')).not.toBeInTheDocument()
  const manual = (await api.listJobs()).filter((j) => j.source === 'manual' && j.status !== 'rejected')
  expect(screen.getAllByText(manual[0].title).length).toBeGreaterThan(0)
})

it('sets how you applied from the drawer, saving each change at once', async () => {
  const api = renderWithApi(<BoardPage />)
  await userEvent.click(await screen.findByText('.NET Developer (Junior)'))
  const drawer = await screen.findByRole('dialog')
  expect(within(drawer).getByText(/Outcome: No reply/)).toBeInTheDocument()

  await userEvent.click(within(drawer).getByLabelText('Channel'))
  await userEvent.click(await screen.findByTitle('Referral'))
  await userEvent.click(within(drawer).getByLabelText('Resume'))
  await userEvent.type(await screen.findByLabelText('New resume version'), 'Data / ML')
  await userEvent.click(screen.getByRole('button', { name: /Add/ }))

  await waitFor(async () => {
    const job = (await api.listJobs()).find((j) => j.title === '.NET Developer (Junior)')!
    expect(job).toMatchObject({ channel: 'referral', resume_version: 'data_ml' })
  })
})

it('leaves the application fields out until you apply', async () => {
  renderWithApi(<BoardPage />)
  await userEvent.click(await screen.findByText('Junior Full Stack Developer'))
  const drawer = await screen.findByRole('dialog')
  expect(within(drawer).queryByLabelText('Channel')).not.toBeInTheDocument()
})

it('logs an application no scraper found and opens it', async () => {
  const api = renderWithApi(<BoardPage />)
  await screen.findByText('Junior Full Stack Developer')
  await userEvent.click(screen.getByRole('button', { name: /Log application/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Log an application' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Log application' }))
  expect(await within(dialog).findByText('Name the role')).toBeInTheDocument()

  await userEvent.type(within(dialog).getByLabelText('Role'), 'Platform Engineer')
  await userEvent.type(within(dialog).getByLabelText(/^Company/), 'Referral Co')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Log application' }))

  expect(await screen.findByText('Application logged')).toBeInTheDocument()
  const logged = (await api.listJobs()).find((j) => j.title === 'Platform Engineer')!
  expect(logged).toMatchObject({ source: 'manual', status: 'applied', channel: 'referral', company: 'Referral Co' })
  expect(logged.applied_at).not.toBeNull()
  expect(within(column(/^Applied:/)).getByText('Platform Engineer')).toBeInTheDocument()
})
