import { demoDescription, demoFilteredJobs, demoJobs } from './demoData'
import type { DataApi, JobKey } from './types'

const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' }
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

/** In-memory data for the public demo: edits last until the page reloads. */
export function createDemoApi(): DataApi {
  const jobs = demoJobs()
  const filtered = demoFilteredJobs()
  const find = (key: JobKey) => {
    const job = jobs.find((j) => j.source === key.source && j.external_id === key.external_id)
    if (!job) throw new Error('Job not found')
    return job
  }

  return {
    demo: true,
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
      if (patch.status && patch.status !== job.status) job.status_changed_at = new Date().toISOString()
      Object.assign(job, patch)
      return { ...job }
    },
    async listFilteredJobs(days) {
      await wait()
      const since = Date.now() - days * 86_400_000
      return filtered.filter((j) => Date.parse(j.first_seen) >= since)
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
