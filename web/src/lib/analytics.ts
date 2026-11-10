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

/**
 * Kept jobs per day and source for the last `days` days (oldest first, empty
 * days included). Applications you logged yourself weren't found by a scraper.
 */
export function jobsPerDay(jobs: Pick<Job, 'source' | 'first_seen'>[], days: number, now = dayjs()): DayCount[] {
  const counts = new Map<string, DayCount>()
  for (let i = days - 1; i >= 0; i--) {
    const day = now.subtract(i, 'day').format('YYYY-MM-DD')
    counts.set(day, { day, jobstreet: 0, linkedin: 0, himalayas: 0 })
  }
  for (const job of jobs) {
    const entry = counts.get(dayjs(job.first_seen).format('YYYY-MM-DD'))
    if (entry && job.source !== 'manual') entry[job.source] += 1
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
const RESPONSE: JobStatus[] = ['exam', 'interview', 'offer', 'rejected']

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
 * history, so their current status stands in). Rejected, exam, interview and
 * offer all imply an application.
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
 * Days from applying to the first response, from applied_at and
 * first_response_at (filled in by the database from the status changes, and
 * editable). Null when either is unknown.
 */
export const daysToResponse = (job: Pick<Job, 'applied_at' | 'first_response_at'>) =>
  job.applied_at && job.first_response_at
    ? (Date.parse(job.first_response_at) - Date.parse(job.applied_at)) / DAY
    : null

// ---- Applications: outcomes and what gets responses ------------------------------

/**
 * How an application went, derived from the board, never stored: the furthest
 * stage it ever reached (offer, interview, exam), else rejected if it was
 * rejected without one, else no reply yet. So an interview that ended in a
 * rejection still counts as an interview.
 */
export type Outcome = 'no_reply' | 'rejected' | 'exam' | 'interview' | 'offer'

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_reply: 'No reply', rejected: 'Rejected', exam: 'Exam', interview: 'Interview', offer: 'Offer',
}

export function deriveOutcome(reached: ReadonlySet<JobStatus>): Outcome {
  for (const stage of ['offer', 'interview', 'exam', 'rejected'] as const) if (reached.has(stage)) return stage
  return 'no_reply'
}

export interface Application {
  job: Job
  /** Every status the job has had. */
  reached: ReadonlySet<JobStatus>
  outcome: Outcome
  /** Days from applying to the first response; null when either date is unknown. */
  days: number | null
}

/** The jobs you applied to (they reached Applied, Emailed or any later stage), with their outcomes. */
export function applications(jobs: Job[], history: StatusChange[]): Application[] {
  const statuses = statusesByJob(jobs, history)
  return jobs.flatMap((job) => {
    const reached = statuses.get(jobKeyString(job))!
    if (![...APPLIED, ...RESPONSE].some((s) => reached.has(s))) return []
    return [{ job, reached, outcome: deriveOutcome(reached), days: daysToResponse(job) }]
  })
}

/** Applications made in the last `days` days (by applied_at, or first_seen when that's unknown). */
export const appliedWithin = (apps: Application[], days: number, now = Date.now()) =>
  apps.filter((a) => Date.parse(a.job.applied_at ?? a.job.first_seen) >= now - days * DAY)

/** Fewer applications than this in a group is too few to compare rates. */
export const MIN_SAMPLE = 10

export type Dimension = 'channel' | 'resume_version' | 'role_type' | 'work_setup'

export interface GroupStats {
  /** The field's value, e.g. 'referral'; or 'all' for the total. */
  key: string
  applications: number
  /** Any outcome other than no reply. */
  responses: number
  responseRate: number
  /** Reached an interview (or an offer). */
  interviews: number
  interviewRate: number
  medianDays: number | null
  /** How many responses have both dates, i.e. what medianDays is based on. */
  timedResponses: number
  /** Below MIN_SAMPLE: shown, but marked "not enough data". */
  lowSample: boolean
}

function stats(key: string, apps: Application[]): GroupStats {
  const responded = apps.filter((a) => a.outcome !== 'no_reply')
  const interviews = apps.filter((a) => a.reached.has('interview') || a.reached.has('offer')).length
  const days = responded.flatMap((a) => (a.days === null ? [] : [a.days]))
  return {
    key,
    applications: apps.length,
    responses: responded.length,
    responseRate: apps.length ? responded.length / apps.length : 0,
    interviews,
    interviewRate: apps.length ? interviews / apps.length : 0,
    medianDays: median(days),
    timedResponses: days.length,
    lowSample: apps.length < MIN_SAMPLE,
  }
}

/**
 * Response and interview rates per value of one field, most applications
 * first ('unknown' last), plus the total across every value.
 */
export function breakdown(apps: Application[], dimension: Dimension) {
  const groups = new Map<string, Application[]>()
  for (const app of apps) groups.set(app.job[dimension], [...(groups.get(app.job[dimension]) ?? []), app])
  const rows = [...groups]
    .map(([key, list]) => stats(key, list))
    .sort((a, b) => Number(a.key === 'unknown') - Number(b.key === 'unknown')
      || b.applications - a.applications || a.key.localeCompare(b.key))
  return { rows, total: stats('all', apps) }
}

export interface DropOffStage {
  stage: 'exam' | 'interview'
  /** Applications that ever reached this stage. */
  reached: number
  /** ...and then a later one (interview or offer after an exam; offer after an interview). */
  progressed: number
  /** ...and were rejected without getting further. */
  rejected: number
  /** ...and are still at this stage. */
  waiting: number
  /** ...and ended some other way (e.g. you withdrew and marked it Skip). */
  other: number
}

/** Of the applications that reached an exam or interview, how many went further. */
export function dropOff(apps: Application[]): DropOffStage[] {
  const later: Record<DropOffStage['stage'], JobStatus[]> = { exam: ['interview', 'offer'], interview: ['offer'] }
  return (['exam', 'interview'] as const).map((stage) => {
    const at = apps.filter((a) => a.reached.has(stage) || (stage === 'interview' && a.reached.has('offer')))
    const progressed = at.filter((a) => later[stage].some((s) => a.reached.has(s)))
    const rest = at.filter((a) => !progressed.includes(a))
    const rejected = rest.filter((a) => a.reached.has('rejected')).length
    const waiting = rest.filter((a) => !a.reached.has('rejected') && a.job.status === stage).length
    return {
      stage, reached: at.length, progressed: progressed.length, rejected, waiting,
      other: rest.length - rejected - waiting,
    }
  })
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
