import { expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDemoApi } from '../data/demoApi'
import { renderWithApi } from '../test/renderWithApi'
import { Link } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'

const daysInput = () => screen.getByLabelText('Only jobs listed in the last')

it('shows the current version and saves edits as a new version', async () => {
  const api = renderWithApi(<SettingsPage />)
  expect(await screen.findByText(/^Version 1, saved/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Save as new version/ })).not.toBeInTheDocument()

  await userEvent.clear(daysInput())
  await userEvent.type(daysInput(), '7')
  await userEvent.type(screen.getByLabelText('Note for this version'), 'Look back a week')
  await userEvent.click(screen.getByRole('button', { name: /Save as new version/ }))

  await waitFor(async () => expect((await api.listSettingsVersions())).toHaveLength(2))
  const [latest] = await api.listSettingsVersions()
  expect(latest.settings.search.listed_within_days).toBe(7)
  expect(latest.note).toBe('Look back a week')
  expect(await screen.findByText(/^Version 2, saved/)).toBeInTheDocument()
}, 20_000)

it('explains what to fix instead of saving invalid rules', async () => {
  const api = renderWithApi(<SettingsPage />)
  await screen.findByText(/^Version 1, saved/)
  await userEvent.click(screen.getByRole('tab', { name: 'Description checks' }))
  const flag = screen.getByLabelText('Flag jobs asking for')
  await userEvent.clear(flag)
  await userEvent.type(flag, '9')
  await userEvent.click(screen.getByRole('button', { name: /Save as new version/ }))

  expect(await screen.findByText('Fix these before saving')).toBeInTheDocument()
  expect(screen.getByText(/"flag at" must be lower than "drop at"/)).toBeInTheDocument()
  expect(await api.listSettingsVersions()).toHaveLength(1)
})

it('restores an older version as a new one', async () => {
  const api = createDemoApi()
  const [first] = await api.listSettingsVersions()
  await api.saveSettings({ ...first.settings, min_match_score: 8 }, 'Stricter')
  renderWithApi(<SettingsPage />, api)

  expect(await screen.findByText(/^Version 2, saved/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /History/ }))
  const drawer = await screen.findByRole('dialog')
  expect(within(drawer).getByText('Changed: minimum score')).toBeInTheDocument()
  await userEvent.click(within(drawer).getByRole('button', { name: 'Restore' }))
  const [title] = await screen.findAllByText('Restore version 1?')
  const confirm = title.closest('.ant-modal') as HTMLElement
  await userEvent.click(within(confirm).getByRole('button', { name: 'Restore' }))

  await waitFor(async () => expect(await api.listSettingsVersions()).toHaveLength(3))
  const [latest] = await api.listSettingsVersions()
  expect(latest.note).toBe('Restored version 1')
  expect(latest.settings.min_match_score).toBe(first.settings.min_match_score)
}, 20_000)

it('asks before leaving the page with unsaved edits', async () => {
  renderWithApi(<><Link to="/jobs">Go to jobs</Link><SettingsPage /></>)
  await screen.findByText(/^Version 1, saved/)
  await userEvent.clear(daysInput())
  await userEvent.type(daysInput(), '9')
  await userEvent.click(screen.getByRole('link', { name: 'Go to jobs' }))
  expect((await screen.findAllByText('Discard unsaved rule changes?'))[0]).toBeInTheDocument()
})

it('treats a saved version as unchanged even when its keys come back reordered', async () => {
  // Supabase stores settings as jsonb, which re-sorts object keys; the demo API keeps them.
  const reorder = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)]))
        : value
  const api = createDemoApi()
  const [first] = await api.listSettingsVersions()
  await api.saveSettings(reorder(first.settings) as typeof first.settings, null)
  renderWithApi(<><Link to="/jobs">Go to jobs</Link><SettingsPage /></>, api)

  expect(await screen.findByText(/^Version 2, saved/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Save as new version/ })).not.toBeInTheDocument()

  // After saving an edit, nothing is left unsaved and leaving doesn't ask.
  await userEvent.clear(daysInput())
  await userEvent.type(daysInput(), '7')
  await userEvent.click(screen.getByRole('button', { name: /Save as new version/ }))
  expect(await screen.findByText(/^Version 3, saved/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Save as new version/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Go to jobs' }))
  expect(screen.queryByText('Discard unsaved rule changes?')).not.toBeInTheDocument()
}, 20_000)

it('opens the tab named in the link and shows what each title rule dropped', async () => {
  renderWithApi(<SettingsPage />, undefined, '/rules?tab=titles&rule=seniority%20title')
  expect(await screen.findByRole('tab', { name: 'Title rules', selected: true })).toBeInTheDocument()
  expect((await screen.findAllByText(/^Dropped \d+ jobs? in the last 30 days$/)).length).toBeGreaterThan(0)
})
