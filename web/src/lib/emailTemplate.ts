import type { Job } from '../data/types'

/**
 * The application email the "Draft in Gmail" button fills in. It's kept in
 * this browser's storage, not the repo, because it holds personal details.
 */
export interface EmailTemplate {
  subject: string
  body: string
  /** Which signed-in Gmail account to open, e.g. you@gmail.com. Blank = the default one. */
  gmailAccount: string
}

// Same wording as the generic default in apps_script/Code.gs.
export const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: 'Inquiry: {title} Position',
  body: [
    'Dear Hiring Team,',
    '',
    'I am writing to ask whether the {title} position{at_company} is still open. '
      + 'If it is, I would like to express my interest in applying.',
    '',
    'I have attached my CV for your review.',
    '',
    'Thank you for your time and consideration.',
  ].join('\n'),
  gmailAccount: '',
}

export const PLACEHOLDERS = ['{title}', '{company}', '{at_company}']

const KEY = 'jobtracker.emailTemplate'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export function loadTemplate(storage: Storage | undefined = globalThis.localStorage): EmailTemplate {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null')
    if (saved && typeof saved === 'object') return { ...DEFAULT_TEMPLATE, ...saved }
  } catch {
    // unreadable or blocked: use the default
  }
  return DEFAULT_TEMPLATE
}

export function saveTemplate(template: EmailTemplate, storage: Storage | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(template))
    return true
  } catch {
    return false
  }
}

/** Advertisers that aren't a real company name. */
const ANONYMOUS = /private advertiser|confidential/i

/** Fills {title}, {company} and {at_company} (" at Acme", or blank when the company is unknown). */
export function fillTemplate(text: string, job: Pick<Job, 'title' | 'company'>): string {
  const company = job.company?.trim() ?? ''
  const known = company !== '' && !ANONYMOUS.test(company)
  return text
    .replaceAll('{title}', job.title)
    .replaceAll('{company}', known ? company : 'your company')
    .replaceAll('{at_company}', known ? ` at ${company}` : '')
}

/** A Gmail "compose" link with everything filled in. */
export function gmailComposeUrl({ to, subject, body, account }: {
  to: string[]
  subject: string
  body: string
  account?: string
}): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: to.join(','), su: subject, body })
  if (account?.trim()) params.set('authuser', account.trim())
  return `https://mail.google.com/mail/?${params}`
}
