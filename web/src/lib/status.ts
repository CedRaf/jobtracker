import type { GlobalToken } from 'antd'
import type { JobStatus } from '../data/types'

// antd preset colours (they adapt to dark mode). "New" shares the teal primary:
// it's the review queue. Applied and Emailed sit far apart (blue, gold) so their
// small dots don't blur together; Rejected and Skip differ too. Exam (magenta)
// leads into Interview (purple). Emailed is legacy: only jobs emailed before
// it merged into Applied have it (the channel now says how you applied).
export const STATUS_META: Record<JobStatus, { label: string; color: string }> = {
  new: { label: 'New', color: 'cyan' },
  applied: { label: 'Applied', color: 'blue' },
  emailed: { label: 'Emailed', color: 'gold' },
  exam: { label: 'Exam', color: 'magenta' },
  interview: { label: 'Interview', color: 'purple' },
  offer: { label: 'Offer', color: 'green' },
  rejected: { label: 'Rejected', color: 'volcano' },
  withdrawn: { label: 'Withdrawn', color: 'geekblue' },
  skip: { label: 'Skip', color: 'default' },
  expired: { label: 'Expired', color: 'orange' },
}

export const STATUSES = Object.keys(STATUS_META) as JobStatus[]

/** Statuses shown by default: everything still in play. Expired postings stay hidden. */
export const ACTIVE_STATUSES: JobStatus[] = ['new', 'applied', 'emailed', 'exam', 'interview', 'offer']

export const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_META[value].label }))

/** The dot colour for a status, from the same antd preset as its tag. */
export function statusDotColor(status: JobStatus, token: GlobalToken) {
  const preset = STATUS_META[status].color
  if (preset === 'default') return token.colorTextQuaternary
  return (token as unknown as Record<string, string>)[`${preset}6`] ?? token.colorPrimary
}
