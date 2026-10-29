import dayjs from 'dayjs'
import type { FilteredJob, Job, JobSource, JobStatus, ScrapeRun, StatusChange } from '../data/types'
import { jobKeyString } from '../data/types'
import { groupByReason } from './reasons'

const DAY = 86_400_000

/** Jobs first seen in the last `days` days. */
export const seenWithin = <T extends { first_seen: string }>(items: T[], days: number, now = Date.now()) =>
  items.filter((item) => Date.parse(item.first_seen) >= now - days * DAY)

// ---- New jobs per day -------------------------------------------------------

export interface DayCount {
  /** YYYY-MM-DD, local time */
  day: string
  jobstreet: number
  linkedin: number
  himalayas: number
}

/** Kept jobs per day and source for the last `days` days (oldest first, empty days included). */
export function jobsPerDay(jobs: Pick<Job, 'source' | 'first_seen'>[], days: number, now = dayjs()): DayCount[] {
  const counts = new Map<string, DayCount>()
  for (let i = days - 1; i >= 0; i--) {
    const day = now.subtract(i, 'day').format('YYYY-MM-DD')
    counts.set(day, { day, jobstreet: 0, linkedin: 0, himalayas: 0 })
  }
  for (const job of jobs) {
    const entry = counts.get(dayjs(job.first_seen).format('YYYY-MM-DD'))
    if (entry) entry[job.source] += 1
  }
  return [...counts.values()]
}

// ---- Skills -------------------------------------------------------------------

export interface SkillCount {
  skill: string
  count: number
}

const countValues = (lists: string[][], top: number): SkillCount[] => {
  const counts = new Map<string, number>()
  for (const list of lists) for (const value of new Set(list)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, top)
}

/** How many jobs mention each of your skills, and each stack you don't have. */
export function skillDemand(jobs: Pick<Job, 'matched_skills' | 'missing_skills'>[], top = 10) {
  return {
    yours: countValues(jobs.map((j) => j.matched_skills), top),
    others: countValues(jobs.map((j) => j.missing_skills), top),
  }
}

// ---- Application funnel ---------------------------------------------------------

const APPLIED: JobStatus[] = ['applied', 'emailed']
const RESPONSE: JobStatus[] = ['interview', 'offer', 'rejected']

/** Every status a job has had: its history plus its current status. */
function statusesByJob(jobs: Job[], history: StatusChange[]) {
  const seen = new Map<string, Set<JobStatus>>()
  for (const job of jobs) seen.set(jobKeyString(job), new Set([job.status]))
  for (const change of history) {
    seen.get(jobKeyString({ source: change.job_source, external_id: change.job_external_id }))?.add(change.to_status)
  }
  return seen
}

export interface FunnelStage {
  key: string
  label: string
  count: number
}

/**
 * How far jobs got. A job counts for a stage if it ever reached it, judged
 * from its history and current status (jobs imported from the sheet have no
 * history, so their current status stands in). Rejected, interview and offer
 * all imply an application.
 */
export function funnel(jobs: Job[], history: StatusChange[]) {
  const reached = [...statusesByJob(jobs, history).values()]
  const has = (statuses: JobStatus[]) => reached.filter((s) => statuses.some((st) => s.has(st))).length
  const applied = has([...APPLIED, ...RESPONSE])
  const heardBack = has(RESPONSE)
  const stages: FunnelStage[] = [
    { key: 'found', label: 'Found', count: reached.length },
    { key: 'reviewed', label: 'Reviewed', count: reached.filter((s) => [...s].some((st) => st !== 'new')).length },
    { key: 'applied', label: 'Applied or emailed', count: applied },
    { key: 'heard', label: 'Heard back', count: heardBack },
    { key: 'interview', label: 'Interview', count: has(['interview', 'offer']) },
    { key: 'offer', label: 'Offer', count: has(['offer']) },
  ]
  return { stages, responseRate: applied ? heardBack / applied : null }
}

// ---- Time to response -----------------------------------------------------------

export const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Days from the first time each job was marked applied/emailed to the first
 * response after it (interview, offer or rejected). Only jobs with both
 * changes in the history count.
 */
export function responseDays(history: StatusChange[]): number[] {
  const applied = new Map<string, number>()
  const days: number[] = []
  const answered = new Set<string>()
  for (const change of [...history].sort((a, b) => a.changed_at.localeCompare(b.changed_at))) {
    const key = `${change.job_source}:${change.job_external_id}`
    const at = Date.parse(change.changed_at)
    if (APPLIED.includes(change.to_status) && !applied.has(key)) applied.set(key, at)
    else if (RESPONSE.includes(change.to_status) && applied.has(key) && !answered.has(key)) {
      answered.add(key)
      days.push((at - applied.get(key)!) / DAY)
    }
  }
  return days
}

// ---- Filter reasons -------------------------------------------------------------

export const reasonCounts = (filtered: FilteredJob[]) =>
  groupByReason(filtered).map((g) => ({ reason: g.reason, count: g.jobs.length }))

// ---- Scraper health ---------------------------------------------------------------

export type RunState = 'ok' | 'failed' | 'running' | 'interrupted'

/** A run that hasn't finished after this long was cancelled or killed. */
const RUN_TIMEOUT = 60 * 60_000

export function runState(run: Pick<ScrapeRun, 'finished_at' | 'error' | 'started_at'>, now = Date.now()): RunState {
  if (run.error) return 'failed'
  if (run.finished_at) return 'ok'
  return now - Date.parse(run.started_at) > RUN_TIMEOUT ? 'interrupted' : 'running'
}

/** Sources with no run started in the last 24 hours (the scraper runs twice a day). */
export function staleSources(runs: ScrapeRun[], sources: JobSource[], now = Date.now()): JobSource[] {
  return sources.filter(
    (source) => !runs.some((r) => r.source === source && now - Date.parse(r.started_at) < DAY),
  )
}

/** Share of runs in the list that finished without an error. */
export function successRate(runs: ScrapeRun[], now = Date.now()) {
  const done = runs.filter((r) => runState(r, now) !== 'running')
  return done.length ? done.filter((r) => runState(r, now) === 'ok').length / done.length : null
}
