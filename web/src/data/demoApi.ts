import { demoDescription, demoFilteredJobs, demoJobs, demoLatestRuns, demoScrapeRuns, demoStatusHistory } from './demoData'
import { DEFAULT_SETTINGS } from './defaultSettings'
import type {
  DataApi, Job, JobKey, JobStatus, MoveOptions, NewApplication, ResumeVersion, SettingsVersion, StatusChange,
} from './types'
import { resumeKey } from '../lib/application'
import { APPLIED_STAGES, canMove, RESPONSE_STAGES } from '../lib/transitions'

const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' }
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))

/** The fields a status move changes (public.job_status_snapshot). */
type Snapshot = Pick<Job, 'status' | 'applied_at' | 'first_response_at' | 'channel' | 'skip_reason' | 'status_changed_at'>
const snapshot = (j: Job): Snapshot => ({
  status: j.status, applied_at: j.applied_at, first_response_at: j.first_response_at, channel: j.channel,
  skip_reason: j.skip_reason, status_changed_at: j.status_changed_at,
})
const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b)

/** A history row, with what the database keeps beside it for Undo. */
type Row = StatusChange & { before: Snapshot | null; after: Snapshot | null; supersedes: number | null }

/** Errors worded like the database's, so the UI shows the same messages in the demo. */
const refuse = (message: string): never => {
  throw new Error(message)
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
  const history: Row[] = demoStatusHistory(jobs).map((h) => ({ ...h, before: null, after: null, supersedes: null }))
  const record = (
    job: Job, from: JobStatus | null, kind: Row['kind'], before: Snapshot | null, supersedes: number | null = null,
  ) => {
    const row: Row = {
      id: history.length + 1, job_source: job.source, job_external_id: job.external_id, from_status: from,
      to_status: job.status, changed_at: new Date().toISOString(), kind, reverted_at: null,
      undoable: before !== null, before, after: before && snapshot(job), supersedes,
    }
    history.push(row)
    return row
  }
  const checkFrom = (job: Job, from: JobStatus) => {
    if (job.status !== from) refuse(`This job is ${job.status} now, not ${from}: reload and try again`)
  }
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
      // What public.jobs_guard_changes() refuses.
      if (patch.applied_at === null && job.applied_at !== null && APPLIED_STAGES.includes(job.status)) {
        refuse(`A ${job.status} job needs the day you applied`)
      }
      if (patch.first_response_at === null && job.first_response_at !== null && RESPONSE_STAGES.includes(job.status)) {
        refuse('A job that heard back needs the day of the first response')
      }
      if (patch.skip_reason && job.status !== 'skip') refuse('Only a skipped job has a skip reason')
      Object.assign(job, patch)
      return { ...job }
    },
    // What public.change_job_status() does.
    async changeStatus(key, from, to, options: MoveOptions = {}) {
      await wait()
      const job = find(key)
      checkFrom(job, from)
      if (!canMove(job.status, to)) refuse(`A job can't move from ${job.status} to ${to}`)
      const before = snapshot(job)
      const now = new Date().toISOString()
      job.status = to
      job.status_changed_at = now
      job.skip_reason = to === 'skip' ? options.skipReason?.trim() || null : null
      if (to === 'applied') {
        job.applied_at = options.appliedAt ?? job.applied_at ?? now
        job.channel = options.channel
          ?? (job.channel === 'unknown' && job.source !== 'manual' ? 'job_board' : job.channel)
      } else if (APPLIED_STAGES.includes(to)) {
        job.applied_at ??= now
      }
      if (RESPONSE_STAGES.includes(to) && job.first_response_at === null) {
        job.first_response_at = job.applied_at && job.applied_at > now ? job.applied_at : now
      }
      return { job: { ...job }, historyId: record(job, before.status, 'change', before).id }
    },
    // What public.revert_status_change() does.
    async revertStatus(historyId) {
      await wait()
      const row = history.find((h) => h.id === historyId) ?? refuse('Change not found')
      if (row.reverted_at) refuse('That change was already undone')
      if (!row.before || !row.after) refuse("Changes made before Undo existed can't be undone: use Correct status")
      const later = history.some((h) => h.id > row.id && h.reverted_at === null
        && h.job_source === row.job_source && h.job_external_id === row.job_external_id)
      if (later) refuse('Only the latest change can be undone')
      const job = find({ source: row.job_source, external_id: row.job_external_id })
      if (!sameSnapshot(snapshot(job), row.after!)) refuse('The job was edited after that change: use Correct status')
      Object.assign(job, row.before)
      row.reverted_at = new Date().toISOString()
      const replaced = history.find((h) => h.id === row.supersedes)
      if (replaced) replaced.reverted_at = null
      return { ...job }
    },
    // What public.correct_job_status() does.
    async correctStatus(key, from, to, options = {}) {
      await wait()
      const job = find(key)
      checkFrom(job, from)
      if (to === 'emailed') refuse('Emailed is no longer a status: use Applied with the direct message channel')
      if (job.status === to) refuse(`The job is already ${to}`)
      const now = new Date().toISOString()
      const latest = history.filter((h) => h.reverted_at === null
        && h.job_source === job.source && h.job_external_id === job.external_id).at(-1)
      let replaced: number | null = null
      if (latest && latest.to_status === job.status) {
        latest.reverted_at = now
        replaced = latest.id
      }
      const before = snapshot(job)
      const neverApplied = to === 'new' || to === 'skip' || to === 'expired'
      job.status = to
      job.status_changed_at = now
      job.skip_reason = to === 'skip' ? options.skipReason?.trim() || null : null
      job.applied_at = neverApplied ? null : job.applied_at ?? now
      if (neverApplied || to === 'applied') job.first_response_at = null
      else if (RESPONSE_STAGES.includes(to)) job.first_response_at ??= now
      if (!neverApplied && job.channel === 'unknown' && job.source !== 'manual') job.channel = 'job_board'
      return { job: { ...job }, historyId: record(job, before.status, 'correction', before, replaced).id }
    },
    async logApplication(application) {
      await wait()
      const now = new Date().toISOString()
      const job = manualJob(application, `manual-${jobs.length}`, now)
      // What public.jobs_track_application() does on insert.
      if (APPLIED_STAGES.includes(job.status)) job.applied_at ??= now
      jobs.unshift(job)
      if (job.status !== 'new') record(job, null, 'change', null).changed_at = job.applied_at ?? now
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
      return history.map(({ before: _before, after: _after, supersedes: _supersedes, ...h }) => h)
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
