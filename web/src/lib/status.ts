import type { GlobalToken } from 'antd'
import type { JobStatus } from '../data/types'

// antd preset colours (they adapt to dark mode). "New" shares the teal primary:
// it's the review queue. Rejected and Skip differ so closed jobs can be told apart.
export const STATUS_META: Record<JobStatus, { label: string; color: string }> = {
  new: { label: 'New', color: 'cyan' },
  applied: { label: 'Applied', color: 'blue' },
  emailed: { label: 'Emailed', color: 'geekblue' },
  interview: { label: 'Interview', color: 'purple' },
  offer: { label: 'Offer', color: 'green' },
  rejected: { label: 'Rejected', color: 'volcano' },
  skip: { label: 'Skip', color: 'default' },
}

export const STATUSES = Object.keys(STATUS_META) as JobStatus[]

/** Statuses shown by default: everything still in play. */
export const ACTIVE_STATUSES: JobStatus[] = ['new', 'applied', 'emailed', 'interview', 'offer']

export const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_META[value].label }))

/** The dot colour for a status, from the same antd preset as its tag. */
export function statusDotColor(status: JobStatus, token: GlobalToken) {
  const preset = STATUS_META[status].color
  if (preset === 'default') return token.colorTextQuaternary
  return (token as unknown as Record<string, string>)[`${preset}6`] ?? token.colorPrimary
}
