import type { Job, JobStatus } from '../data/types'
import { flagCategories } from './flags'
import { ACTIVE_STATUSES } from './status'

/** Filters within one source tab (the tabs pick JobStreet or LinkedIn). */
export interface JobFilters {
  text: string
  /** Empty = every status. */
  statuses: JobStatus[]
  /** Job matches if it has any of these. */
  arrangements: string[]
  minScore: number
  /** FLAG_CATEGORIES keys; job must have all of them. */
  flags: string[]
  /** Job must have all of these. */
  skills: string[]
  newOnly: boolean
  /** Only jobs with the Entry-level marker. */
  entryLevelOnly: boolean
}

export const DEFAULT_FILTERS: JobFilters = {
  text: '',
  statuses: ACTIVE_STATUSES,
  arrangements: [],
  minScore: 0,
  flags: [],
  skills: [],
  newOnly: false,
  entryLevelOnly: false,
}

/** Arrangement value for jobs that don't list one. */
export const NOT_LISTED = 'Not listed'

/** True if the job was first seen after the previous visit. No previous visit = nothing is new. */
export function isNewSince(job: Pick<Job, 'first_seen'>, lastVisit: string | null): boolean {
  return lastVisit !== null && Date.parse(job.first_seen) > Date.parse(lastVisit)
}

function matchesText(job: Job, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  return [job.title, job.company, job.location, ...job.matched_skills, job.notes]
    .some((value) => value?.toLowerCase().includes(needle))
}

export function applyFilters(
  jobs: Job[],
  f: JobFilters,
  lastVisit: string | null,
  isEntryLevel: (job: Job) => boolean = () => false,
): Job[] {
  return jobs.filter((job) => {
    const arrangements = job.work_arrangements.length ? job.work_arrangements : [NOT_LISTED]
    const categories = f.flags.length ? flagCategories(job.flags) : null
    return (
      matchesText(job, f.text) &&
      (!f.statuses.length || f.statuses.includes(job.status)) &&
      (!f.arrangements.length || arrangements.some((a) => f.arrangements.includes(a))) &&
      job.match_score >= f.minScore &&
      f.flags.every((key) => categories!.has(key)) &&
      f.skills.every((skill) => job.matched_skills.includes(skill)) &&
      (!f.newOnly || isNewSince(job, lastVisit)) &&
      (!f.entryLevelOnly || isEntryLevel(job))
    )
  })
}

const uniqueSorted = (values: string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b))

/** The arrangement and skill choices present in the data. */
export function filterOptions(jobs: Job[]) {
  return {
    arrangements: uniqueSorted(
      jobs.flatMap((j) => (j.work_arrangements.length ? j.work_arrangements : [NOT_LISTED])),
    ),
    skills: uniqueSorted(jobs.flatMap((j) => j.matched_skills)),
  }
}

/** How many filters differ from the defaults (for the "Reset" button). */
export function activeFilterCount(f: JobFilters): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof JobFilters)[]).filter(
    (key) => JSON.stringify(f[key]) !== JSON.stringify(DEFAULT_FILTERS[key]),
  ).length
}
