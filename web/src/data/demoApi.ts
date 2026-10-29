import { demoDescription, demoFilteredJobs, demoJobs, demoLatestRuns, demoScrapeRuns, demoStatusHistory } from './demoData'
import { DEFAULT_SETTINGS } from './defaultSettings'
import type { DataApi, JobKey, SettingsVersion } from './types'

const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' }
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

/** In-memory data for the public demo: edits last until the page reloads. */
export function createDemoApi(): DataApi {
  const jobs = demoJobs()
  const filtered = demoFilteredJobs()
  const history = demoStatusHistory(jobs)
  const settingsVersions: SettingsVersion[] = [{
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    note: 'Defaults from scraper/default_settings.json',
    created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  }]
  const find = (key: JobKey) => {
    const job = jobs.find((j) => j.source === key.source && j.external_id === key.external_id)
    if (!job) throw new Error('Job not found')
    return job
  }

  return {
    demo: true,
    // The public demo shows a single job site.
    sources: ['jobstreet'],
    // Generic, so the public demo doesn't name any real job site.
    sourceLabels: { jobstreet: 'Job board', linkedin: 'Second job board', himalayas: 'Third job board' },
    async listJobs() {
      await wait()
      return jobs.map((j) => ({ ...j }))
    },
    async getDescription(key) {
      await wait()
      return demoDescription(find(key))
    },
    async updateJob(key, patch) {
      await wait()
      const job = find(key)
      if (patch.status && patch.status !== job.status) {
        // What the database trigger does for real.
        const now = new Date().toISOString()
        history.push({
          job_source: job.source, job_external_id: job.external_id,
          from_status: job.status, to_status: patch.status, changed_at: now,
        })
        job.status_changed_at = now
      }
      Object.assign(job, patch)
      return { ...job }
    },
    async listFilteredJobs(days) {
      await wait()
      const since = Date.now() - days * 86_400_000
      return filtered.filter((j) => Date.parse(j.first_seen) >= since)
    },
    async latestScrapeRuns() {
      await wait()
      return demoLatestRuns()
    },
    async listScrapeRuns(days) {
      await wait()
      const since = Date.now() - days * 86_400_000
      return demoScrapeRuns().filter((r) => Date.parse(r.started_at) >= since)
    },
    async listStatusHistory() {
      await wait()
      return history.map((h) => ({ ...h }))
    },
    async listSettingsVersions() {
      await wait()
      return structuredClone([...settingsVersions].reverse())
    },
    async saveSettings(settings, note) {
      await wait()
      const saved: SettingsVersion = {
        version: settingsVersions.length + 1,
        settings: structuredClone(settings),
        note,
        created_at: new Date().toISOString(),
      }
      settingsVersions.push(saved)
      return structuredClone(saved)
    },
    auth: {
      getUser: async () => DEMO_USER,
      onChange: () => () => {},
      signIn: async () => {},
      signOut: async () => {},
      isAppUser: async () => true,
    },
  }
}
