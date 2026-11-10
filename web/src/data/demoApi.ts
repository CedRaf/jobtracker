import { demoDescription, demoFilteredJobs, demoJobs, demoLatestRuns, demoScrapeRuns, demoStatusHistory } from './demoData'
import { DEFAULT_SETTINGS } from './defaultSettings'
import type { DataApi, Job, JobKey, JobStatus, NewApplication, ResumeVersion, SettingsVersion } from './types'
import { resumeKey } from '../lib/application'

const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' }
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

const APPLIED: JobStatus[] = ['applied', 'emailed', 'exam', 'interview', 'offer', 'rejected']
const RESPONDED: JobStatus[] = ['exam', 'interview', 'offer', 'rejected']

/** What public.jobs_track_application() does on a status change (never overwrites a set value). */
function trackApplication(job: Job, wasApplied: boolean, now: string) {
  if (APPLIED.includes(job.status)) {
    job.applied_at ??= now
    if (job.channel === 'unknown' && job.source !== 'manual') {
      job.channel = job.status === 'emailed' ? 'direct_message' : 'job_board'
    }
  }
  if (RESPONDED.includes(job.status) && wasApplied && job.first_response_at === null) {
    job.first_response_at = now
  }
}

function manualJob(application: NewApplication, external_id: string, now: string): Job {
  return {
    source: 'manual', external_id, work_arrangements: [], work_type: null, salary_text: null, seniority: null,
    posted_at: null, apply_type: null, apply_link: null, match_score: 0, matched_skills: [], missing_skills: [],
    flags: [], emails: [], email_source: null, search_terms: [], status_changed_at: now, skip_reason: null,
    email_drafted_at: null, first_seen: now, channel: 'unknown', resume_version: 'unknown', role_type: 'unknown',
    work_setup: 'unknown', applied_at: null, first_response_at: null,
    ...application,
  }
}

/** In-memory data for the public demo: edits last until the page reloads. */
export function createDemoApi(): DataApi {
  const jobs = demoJobs()
  const filtered = demoFilteredJobs()
  const history = demoStatusHistory(jobs)
  const resumeVersions: ResumeVersion[] = [
    { key: 'unknown', label: 'Unknown' }, { key: 'web', label: 'Web' }, { key: 'ai', label: 'AI' },
  ]
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
    sourceLabels: {
      jobstreet: 'Job board', linkedin: 'Second job board', himalayas: 'Third job board', manual: 'Logged by you',
    },
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
      const before = { status: job.status, applied: job.applied_at !== null }
      Object.assign(job, patch)
      if (patch.status && patch.status !== before.status) {
        // What the database triggers do for real.
        const now = new Date().toISOString()
        history.push({
          job_source: job.source, job_external_id: job.external_id,
          from_status: before.status, to_status: patch.status, changed_at: now,
        })
        job.status_changed_at = now
        trackApplication(job, before.applied, now)
      }
      return { ...job }
    },
    async logApplication(application) {
      await wait()
      const now = new Date().toISOString()
      const job = manualJob(application, `manual-${jobs.length}`, now)
      trackApplication(job, false, now)
      jobs.unshift(job)
      if (job.status !== 'new') {
        history.push({
          job_source: 'manual', job_external_id: job.external_id,
          from_status: null, to_status: job.status, changed_at: job.applied_at ?? now,
        })
      }
      return { ...job }
    },
    async listResumeVersions() {
      await wait()
      return resumeVersions.map((v) => ({ ...v }))
    },
    async addResumeVersion(label) {
      await wait()
      const key = resumeKey(label)
      if (!key) throw new Error('Use at least one letter or digit in the name.')
      if (resumeVersions.some((v) => v.key === key)) throw new Error(`There's already a resume version called ${label}.`)
      const added = { key, label: label.trim() }
      resumeVersions.push(added)
      return { ...added }
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
    // The demo has no scheduler log; Scraper health then leaves that line out.
    async listDispatches() {
      await wait()
      return []
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
