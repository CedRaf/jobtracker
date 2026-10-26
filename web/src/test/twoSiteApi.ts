import { createDemoApi } from '../data/demoApi'
import type { DataApi, Job, JobKey } from '../data/types'

/** Demo jobs that tests treat as coming from the second site. */
const SECOND_SITE = new Set([
  'React Developer (Entry Level)',
  'AI Engineer – Junior',
  'Associate Software Engineer – Platform Integrations and Internal Tooling (Hybrid)',
  'Junior React Native Developer',
])

/**
 * The demo data as the real dashboard sees it: two job sites. The public demo
 * shows one, so tests of the multi-site features (source tabs, the board's
 * source filter) use this.
 */
export function createTwoSiteApi(): DataApi {
  const api = createDemoApi()
  const relabel = (job: Job): Job => (SECOND_SITE.has(job.title) ? { ...job, source: 'linkedin' } : job)
  // The demo stores every job under the first site.
  const stored = (key: JobKey): JobKey => ({ ...key, source: 'jobstreet' })
  return {
    ...api,
    sources: ['jobstreet', 'linkedin'],
    sourceLabels: { jobstreet: 'JobStreet', linkedin: 'LinkedIn' },
    listJobs: async () => (await api.listJobs()).map(relabel),
    getDescription: (key) => api.getDescription(stored(key)),
    updateJob: async (key, patch) => relabel(await api.updateJob(stored(key), patch)),
  }
}
