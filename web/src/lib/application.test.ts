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

// The demo stands in for the database, so it must fill the dates like the trigger does.
describe('demo application tracking', () => {
  const newJob = async () => {
    const api = createDemoApi()
    const job = (await api.listJobs()).find((j) => j.status === 'new' && j.source !== 'manual')!
    return { api, job }
  }

  it('dates the application and the first response, and guesses the channel', async () => {
    const { api, job } = await newJob()
    const applied = await api.updateJob(job, { status: 'emailed' })
    expect(applied.applied_at).not.toBeNull()
    expect(applied.channel).toBe('direct_message')
    expect(applied.first_response_at).toBeNull()
    const answered = await api.updateJob(job, { status: 'interview' })
    expect(answered.first_response_at).not.toBeNull()
  })

  it('never overwrites what you set', async () => {
    const { api, job } = await newJob()
    await api.updateJob(job, { channel: 'referral', applied_at: '2026-10-01T00:00:00Z' })
    const saved = await api.updateJob(job, { status: 'applied' })
    expect(saved.channel).toBe('referral')
    expect(saved.applied_at).toBe('2026-10-01T00:00:00Z')
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
