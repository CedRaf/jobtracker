import type { JobStatus } from '../data/types'

export const STATUS_META: Record<JobStatus, { label: string; color: string }> = {
  new: { label: 'New', color: 'blue' },
  applied: { label: 'Applied', color: 'geekblue' },
  emailed: { label: 'Emailed', color: 'cyan' },
  interview: { label: 'Interview', color: 'purple' },
  offer: { label: 'Offer', color: 'green' },
  rejected: { label: 'Rejected', color: 'default' },
  skip: { label: 'Skip', color: 'default' },
}

export const STATUSES = Object.keys(STATUS_META) as JobStatus[]

/** Statuses shown by default: everything still in play. */
export const ACTIVE_STATUSES: JobStatus[] = ['new', 'applied', 'emailed', 'interview', 'offer']

export const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_META[value].label }))
