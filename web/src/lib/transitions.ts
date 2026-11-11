import type { Job, JobStatus, StatusChange } from '../data/types'

/**
 * The moves you can make, from each status (docs/STATE_MACHINE_PLAN.md, 1.1).
 * A copy of public.job_status_transitions (system-only moves left out);
 * scraper/tests/test_migrations.py checks the two match. Anything else is fixed
 * with Undo or Correct status, never by moving backwards.
 */
export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  new: ['applied', 'skip'],
  applied: ['exam', 'interview', 'offer', 'rejected', 'withdrawn'],
  emailed: ['exam', 'interview', 'offer', 'rejected', 'withdrawn'],
  exam: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['rejected', 'withdrawn'],
  rejected: [],
  withdrawn: [],
  skip: ['new'],
  expired: ['applied', 'skip'],
}

export const canMove = (from: JobStatus, to: JobStatus) => TRANSITIONS[from].includes(to)

/** Statuses that mean you applied; the database requires an applied date for them. */
export const APPLIED_STAGES: JobStatus[] = ['applied', 'emailed', 'exam', 'interview', 'offer', 'rejected', 'withdrawn']

/** Statuses that mean they replied; the first move into one sets first_response_at. */
export const RESPONSE_STAGES: JobStatus[] = ['exam', 'interview', 'offer', 'rejected']

/** Statuses you can correct a job to (anything but the legacy Emailed). */
export const CORRECTABLE: JobStatus[] = ['new', 'applied', 'exam', 'interview', 'offer', 'rejected', 'withdrawn', 'skip', 'expired']

/** History rows that still count: neither undone nor replaced by a correction. */
export const liveHistory = (history: StatusChange[]) => history.filter((h) => h.reverted_at === null)

/**
 * The job's change that Undo would revert: its latest row that still counts,
 * when it has a snapshot (rows from before Undo existed don't).
 */
export function undoableChange(job: Pick<Job, 'source' | 'external_id' | 'status'>, history: StatusChange[]) {
  const mine = liveHistory(history)
    .filter((h) => h.job_source === job.source && h.job_external_id === job.external_id)
  const latest = mine.at(-1)
  return latest && latest.undoable && latest.to_status === job.status ? latest : null
}
