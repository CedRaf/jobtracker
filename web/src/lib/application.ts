import type { ApplicationChannel, ResumeVersion, RoleType, WorkSetup } from '../data/types'

// Labels for the application fields, in the order the dropdowns list them.
// 'unknown' always comes last: it's what nobody has set yet.

export const CHANNEL_LABELS: Record<ApplicationChannel, string> = {
  job_board: 'Job board',
  direct_message: 'Direct message',
  referral: 'Referral',
  company_site: 'Company site',
  other: 'Other',
  unknown: 'Unknown',
}

export const ROLE_TYPE_LABELS: Record<RoleType, string> = {
  web: 'Web',
  ai: 'AI',
  other: 'Other',
  unknown: 'Unknown',
}

export const WORK_SETUP_LABELS: Record<WorkSetup, string> = {
  cebu_onsite: 'Cebu on-site',
  manila_onsite: 'Manila on-site',
  remote: 'Remote',
  hybrid: 'Hybrid',
  unknown: 'Unknown',
}

export const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }))

/** The resume versions as dropdown options: 'unknown' last, like the others. */
export const resumeOptions = (versions: ResumeVersion[]) =>
  [...versions]
    .sort((a, b) => Number(a.key === 'unknown') - Number(b.key === 'unknown'))
    .map((v) => ({ value: v.key, label: v.label }))

/**
 * The resume_versions key for a new label ("Data / ML" -> "data_ml"), within
 * the database's check: lower case, digits and underscores, at most 32.
 * Null when the label has no letters or digits.
 */
export function resumeKey(label: string): string | null {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  return key.replace(/_+$/, '') || null
}
