import { describe, expect, it } from 'vitest'
import { createDemoApi } from '../data/demoApi'
import { resumeKey, resumeOptions } from './application'

describe('resumeKey', () => {
  it.each([
    ['Web', 'web'],
    ['Data / ML', 'data_ml'],
    ['  AI v2 ', 'ai_v2'],
    ['A'.repeat(40), 'a'.repeat(32)],
    ['---', null],
  ])('%s -> %s', (label, key) => {
    expect(resumeKey(label)).toBe(key)
  })
})

it('resumeOptions lists unknown last', () => {
  expect(resumeOptions([
    { key: 'unknown', label: 'Unknown' }, { key: 'web', label: 'Web' }, { key: 'ai', label: 'AI' },
  ]).map((o) => o.value)).toEqual(['web', 'ai', 'unknown'])
})

// The demo stands in for the database, so it must follow the same status machine
// (supabase/migrations/*_job_status_machine.sql; tested for real in scraper/tests/test_migrations.py).
describe('demo status machine', () => {
  const newJob = async () => {
    const api = createDemoApi()
    const job = (await api.listJobs()).find((j) => j.status === 'new' && j.source !== 'manual')!
    return { api, job }
  }

  it('dates the application and the first response, and defaults the channel', async () => {
    const { api, job } = await newJob()
    const { job: applied } = await api.changeStatus(job, 'new', 'applied')
    expect(applied.applied_at).not.toBeNull()
    expect(applied.channel).toBe('job_board')
    expect(applied.first_response_at).toBeNull()
    const { job: answered } = await api.changeStatus(job, 'applied', 'interview')
    expect(answered.first_response_at).not.toBeNull()
  })

  it('keeps the channel and date you give', async () => {
    const { api, job } = await newJob()
    const { job: saved } = await api.changeStatus(job, 'new', 'applied', {
      channel: 'direct_message', appliedAt: '2026-10-01T00:00:00Z',
    })
    expect(saved.channel).toBe('direct_message')
    expect(saved.applied_at).toBe('2026-10-01T00:00:00Z')
  })

  it('refuses moves outside the table, and moves from a stale screen', async () => {
    const { api, job } = await newJob()
    await expect(api.changeStatus(job, 'new', 'rejected')).rejects.toThrow("can't move")
    await expect(api.changeStatus(job, 'applied', 'interview')).rejects.toThrow('reload')
  })

  it('saves a skip with its reason, and clears it when the job comes back', async () => {
    const { api, job } = await newJob()
    const { job: skipped } = await api.changeStatus(job, 'new', 'skip', { skipReason: ' bond ' })
    expect(skipped.skip_reason).toBe('bond')
    const { job: back } = await api.changeStatus(job, 'skip', 'new')
    expect(back.skip_reason).toBeNull()
  })

  it('undoes a change exactly, and the history marks it undone', async () => {
    const { api, job } = await newJob()
    const { historyId } = await api.changeStatus(job, 'new', 'applied')
    const restored = await api.revertStatus(historyId)
    expect(restored).toMatchObject({ status: 'new', applied_at: job.applied_at, channel: job.channel })
    const row = (await api.listStatusHistory()).find((h) => h.id === historyId)!
    expect(row.reverted_at).not.toBeNull()
  })

  it('only undoes the latest change, and not after an edit', async () => {
    const { api, job } = await newJob()
    const first = await api.changeStatus(job, 'new', 'applied')
    const second = await api.changeStatus(job, 'applied', 'interview')
    await expect(api.revertStatus(first.historyId)).rejects.toThrow('latest')
    await api.updateJob(job, { first_response_at: '2030-01-01T00:00:00Z' })
    await expect(api.revertStatus(second.historyId)).rejects.toThrow('edited')
  })

  it('corrects a status, replacing the one it corrects', async () => {
    const { api, job } = await newJob()
    await api.changeStatus(job, 'new', 'applied')
    const offer = await api.changeStatus(job, 'applied', 'offer')
    const { job: fixed, historyId } = await api.correctStatus(job, 'offer', 'interview')
    expect(fixed.status).toBe('interview')
    const history = await api.listStatusHistory()
    expect(history.find((h) => h.id === offer.historyId)!.reverted_at).not.toBeNull()
    expect(history.find((h) => h.id === historyId)!.kind).toBe('correction')
  })

  it("won't clear a date the status needs", async () => {
    const { api, job } = await newJob()
    await api.changeStatus(job, 'new', 'applied')
    await expect(api.updateJob(job, { applied_at: null })).rejects.toThrow('day you applied')
  })

  it('logs a manual application with its first status in the history', async () => {
    const api = createDemoApi()
    const saved = await api.logApplication({
      title: 'Frontend Developer', company: 'Acme', location: null, url: '', status: 'applied', notes: null,
      channel: 'referral', applied_at: '2026-10-05T00:00:00Z',
    })
    expect(saved.source).toBe('manual')
    expect((await api.listJobs())[0].external_id).toBe(saved.external_id)
    const history = (await api.listStatusHistory()).filter((h) => h.job_external_id === saved.external_id)
    expect(history).toEqual([expect.objectContaining({ from_status: null, to_status: 'applied' })])
  })

  it('adds resume versions once', async () => {
    const api = createDemoApi()
    expect(await api.addResumeVersion('Data / ML')).toEqual({ key: 'data_ml', label: 'Data / ML' })
    await expect(api.addResumeVersion('data ml')).rejects.toThrow(/already/)
  })
})
