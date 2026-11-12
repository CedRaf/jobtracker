// Made-up sample data for demo mode. No real listings or companies.
// One job site only, with a generic name: the public demo doesn't show real site names.
import { APPLIED_STAGES, RESPONSE_STAGES } from '../lib/transitions'
import type {
  ApplicationChannel, FilteredJob, Job, JobStatus, RoleType, ScrapeRun, StatusChange, WorkSetup,
} from './types'

const HOUR = 3_600_000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

interface Seed {
  title: string
  company: string
  location: string
  arrangements: string[]
  score: number
  skills: string[]
  missing?: string[]
  flags?: string[]
  status?: JobStatus
  hoursAgo: number
  salary?: string
  email?: string
  source?: Job['source']
  notes?: string
  /** The status changes behind `status`: [status, hours after first seen]. Default: statusPath(status). */
  path?: [JobStatus, number][]
  channel?: ApplicationChannel
  resume?: string
  role?: RoleType
}

const SEEDS: Seed[] = [
  { title: 'Junior Full Stack Developer', company: 'Lumen Labs', location: 'Cebu City, Cebu', arrangements: ['Hybrid'], score: 17, skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Git'], flags: ['+fresh grads OK'], hoursAgo: 3, salary: '₱30,000 – ₱40,000 per month', email: 'careers@lumenlabs.example' },
  { title: 'Associate Software Engineer', company: 'Harbor Systems', location: 'Cebu, Central Visayas', arrangements: ['On-site'], score: 14, skills: ['C#', '.NET', 'SQL', 'Git'], flags: ['+will train'], hoursAgo: 5 },
  { title: 'React Developer (Entry Level)', company: 'Northwind Digital', location: 'Taguig, Metro Manila', arrangements: ['Remote'], score: 15, skills: ['TypeScript', 'JavaScript', 'React', 'REST API'], missing: ['Next.js'], flags: ['+entry level'], hoursAgo: 8 },
  { title: 'Junior Python Developer', company: 'Datasmith PH', location: 'Cebu City, Cebu', arrangements: ['Hybrid', 'Remote'], score: 11, skills: ['Python', 'pandas', 'SQL', 'Git'], missing: ['Django'], hoursAgo: 20, salary: '₱25,000 – ₱32,000 per month' },
  { title: 'AI Engineer – Junior', company: 'Kestrel AI', location: 'Makati, Metro Manila', arrangements: ['Remote'], score: 13, skills: ['Python', 'AI/LLM', 'LangChain', 'Vector DB'], missing: ['AWS', 'Docker'], flags: ['!3+ yrs exp'], hoursAgo: 26 },
  { title: 'Software Engineer Trainee', company: 'Blue Coral Tech', location: 'Mandaue City, Cebu', arrangements: ['On-site'], score: 9, skills: ['Java', 'SQL', 'JavaScript'], flags: ['!training bond', '+fresh grads OK'], status: 'skip', hoursAgo: 30, notes: '2-year bond, not worth it.' },
  { title: '.NET Developer (Junior)', company: 'Meridian Health IT', location: 'Cebu City, Cebu', arrangements: [], score: 12, skills: ['C#', '.NET', 'SQL'], missing: ['Angular'], flags: ['!no work arrangement listed'], status: 'applied', hoursAgo: 52 },
  { title: 'Junior Web Developer', company: 'Pixel & Pine', location: 'Lapu-Lapu City, Cebu', arrangements: ['On-site'], score: 7, skills: ['JavaScript', 'MySQL'], missing: ['PHP', 'Laravel'], flags: ['!off-stack (PHP, Laravel)'], status: 'rejected', hoursAgo: 70 },
  { title: 'Full Stack Engineer', company: 'Tidewater Software', location: 'Pasig, Metro Manila', arrangements: ['Remote'], score: 19, skills: ['TypeScript', 'React', 'Node.js', 'Express', 'PostgreSQL', 'Prisma'], status: 'interview', hoursAgo: 96, email: 'hiring@tidewater.example', notes: 'Technical interview Thursday 2 PM.' },
  { title: 'Graduate Developer Program', company: 'Summit Fintech', location: 'Cebu City, Cebu', arrangements: ['Hybrid'], score: 10, skills: ['JavaScript', 'SQL', 'Git'], flags: ['+fresh grads OK', '+will train'], status: 'emailed', hoursAgo: 120, email: 'talent@summitfintech.example' },
  { title: 'Associate Software Engineer – Platform Integrations and Internal Tooling (Hybrid)', company: 'Meridian Global Business Services Philippines, Inc.', location: 'Cebu IT Park, Cebu City, Central Visayas, Philippines', arrangements: ['Hybrid', 'On-site'], score: 10, skills: ['JavaScript', 'SQL', 'Git', 'REST API'], missing: ['PHP', 'Laravel', 'WordPress'], flags: ['!off-stack (PHP, Laravel, WordPress)', '!3+ yrs exp', '!training bond', '+fresh grads OK'], hoursAgo: 40 },
  { title: 'Junior React Native Developer', company: 'Orbit Apps', location: 'Cebu City, Cebu', arrangements: ['Remote'], score: 12, skills: ['React Native', 'TypeScript', 'REST API'], missing: ['Kotlin'], hoursAgo: 150 },
  { title: 'Backend Developer (Node.js)', company: 'Cascade Logistics', location: 'Cebu City, Cebu', arrangements: ['On-site'], score: 11, skills: ['Node.js', 'Express', 'MySQL'], missing: ['Docker'], status: 'applied', hoursAgo: 200 },
]

// Older, already-triaged jobs (9–30 days ago), so the analytics have a month to chart.
const OLDER_TITLES = [
  'Junior Software Developer', 'Associate Developer', 'Junior Frontend Developer', 'Web Developer',
  'Junior Backend Engineer', 'Software Engineer I', 'Junior .NET Developer', 'Junior React Developer',
  'Graduate Software Engineer', 'Junior QA Automation Engineer',
]
const OLDER_COMPANIES = [
  'Coral Bay Systems', 'Islandsoft', 'Bright Harbor', 'Tandem Labs', 'Mactan Digital', 'Northpeak',
  'Sugbo Tech', 'Lighthouse Apps', 'Vista Ledger', 'Copperleaf',
]
const SKILL_POOL = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'C#', '.NET', 'SQL', 'PostgreSQL', 'Python', 'Git', 'REST API', 'MySQL']
const OTHER_POOL = ['PHP', 'Laravel', 'Angular', 'Vue', 'Docker', 'AWS', 'Java', 'Next.js']
const OLDER_STATUSES: JobStatus[] = [
  'skip', 'skip', 'skip', 'skip', 'applied', 'applied', 'rejected', 'rejected', 'emailed', 'interview', 'skip', 'offer',
]

function olderSeeds(): Seed[] {
  const rand = random(42)
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)]
  return Array.from({ length: 36 }, (_, i) => {
    const skills = SKILL_POOL.filter(() => rand() < 0.3).slice(0, 5)
    return {
      title: pick(OLDER_TITLES),
      company: pick(OLDER_COMPANIES),
      location: rand() < 0.75 ? 'Cebu City, Cebu' : 'Makati, Metro Manila',
      arrangements: [pick(['On-site', 'Hybrid', 'Remote'])],
      score: 6 + Math.round(rand() * 12),
      skills: skills.length ? skills : ['JavaScript'],
      missing: OTHER_POOL.filter(() => rand() < 0.15),
      status: OLDER_STATUSES[i % OLDER_STATUSES.length],
      hoursAgo: 216 + Math.round(rand() * 500),
      source: 'jobstreet',
    }
  })
}

// Past applications with their attributes filled in, so the "what gets
// responses" analytics have something to show. Responses are more likely for
// referrals and direct messages, and when the resume matches the role.
const PAST_TITLES: Record<Exclude<RoleType, 'unknown'>, string[]> = {
  // Titles not used by the other demo jobs (the page tests look those up by
  // name) and without Entry-level words, so they don't sort ahead of them.
  web: ['Frontend Engineer', 'Full Stack Web Developer', 'Web Engineer', 'UI Developer'],
  ai: ['ML Engineer', 'Machine Learning Developer', 'AI Application Developer'],
  other: ['QA Engineer', 'Data Analyst'],
}
const PAST_COMPANIES = [
  'Reefline Software', 'Kalinaw Labs', 'Tanaw Analytics', 'Bayanihan Cloud', 'Sinag Systems', 'Lantaw AI',
  'Habagat Digital', 'Pulo Apps', 'Dagat Data', 'Alon Tech', 'Hiraya Studio', 'Kidlat Works',
]
const SETUP_PLACES: Record<Exclude<WorkSetup, 'unknown'>, [string, string[]]> = {
  cebu_onsite: ['Cebu City, Cebu', ['On-site']],
  manila_onsite: ['Makati, Metro Manila', ['On-site']],
  remote: ['Philippines', ['Remote']],
  hybrid: ['Cebu City, Cebu', ['Hybrid']],
}
const CHANNEL_BOOST: Record<ApplicationChannel, number> = {
  referral: 0.45, direct_message: 0.15, company_site: 0.05, job_board: 0, other: 0, unknown: 0,
}

function pastApplications(): Seed[] {
  const rand = random(7)
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)]
  const weighted = <T extends string>(weights: [T, number][]): T => {
    let r = rand() * weights.reduce((sum, [, w]) => sum + w, 0)
    for (const [value, w] of weights) if ((r -= w) <= 0) return value
    return weights[0][0]
  }
  return Array.from({ length: 64 }, (_, i) => {
    const manual = i % 8 === 0
    const channel = manual
      ? weighted<ApplicationChannel>([['referral', 2], ['direct_message', 1], ['company_site', 1]])
      : weighted<ApplicationChannel>([['job_board', 6], ['direct_message', 2], ['company_site', 1], ['referral', 0.5]])
    const role = weighted<Exclude<RoleType, 'unknown'>>([['web', 6], ['ai', 3], ['other', 1]])
    const resume = rand() < 0.75 ? (role === 'ai' ? 'ai' : 'web') : pick(['web', 'ai'])
    const setup = weighted<Exclude<WorkSetup, 'unknown'>>([['cebu_onsite', 4], ['remote', 4], ['hybrid', 2], ['manila_onsite', 1]])
    const hoursAgo = 100 + Math.round(rand() * 600)
    const applied = manual ? 0 : 2 + Math.round(rand() * 20)
    const chance = 0.18 + CHANNEL_BOOST[channel] + (resume === role ? 0.12 : 0) - (setup === 'remote' ? 0.08 : 0)

    const path: [JobStatus, number][] = [[!manual && rand() < 0.3 ? 'emailed' : 'applied', applied]]
    let at = applied + 24 * (1 + rand() * 13)
    if (rand() < chance) {
      // How far it got: an exam first for some, then maybe an interview and an offer.
      const stages: JobStatus[] = []
      const exam = rand() < 0.45
      if (exam) stages.push('exam')
      if (!exam || rand() < 0.55) {
        stages.push('interview')
        stages.push(rand() < 0.3 ? 'offer' : 'rejected')
      } else {
        stages.push('rejected')
      }
      if (!exam && stages[0] === 'interview' && rand() < 0.35) stages.splice(0, 2, 'rejected')
      for (const stage of stages) {
        if (at >= hoursAgo - 1) break // still waiting
        path.push([stage, at])
        at += 24 * (3 + rand() * 5)
      }
    }
    const [location, arrangements] = SETUP_PLACES[setup]
    return {
      title: pick(PAST_TITLES[role]),
      company: pick(PAST_COMPANIES),
      location,
      arrangements,
      score: 8 + Math.round(rand() * 10),
      skills: role === 'ai' ? ['Python', 'AI/LLM'] : ['TypeScript', 'React'],
      status: path.at(-1)![0],
      hoursAgo,
      source: manual ? 'manual' : 'jobstreet',
      path,
      channel,
      resume,
      role,
    }
  })
}

// Mirrors public.guess_work_setup() in the application-tracking migration.
function guessWorkSetup(arrangements: string[], location: string): WorkSetup {
  const kinds = [...new Set(arrangements.map((a) => a.toLowerCase()))]
  const only = (kind: string) => kinds.length === 1 && kinds[0] === kind
  if (only('remote')) return 'remote'
  if (kinds.includes('hybrid') && !kinds.includes('remote')) return 'hybrid'
  if (only('on-site') && /cebu/i.test(location)) return 'cebu_onsite'
  if (only('on-site') && /manila|makati|taguig|pasig|quezon city|mandaluyong/i.test(location)) return 'manila_onsite'
  return 'unknown'
}


const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Each demo job's status changes, by external_id (read by demoStatusHistory). */
const paths = new Map<string, [JobStatus, number][]>()

export function demoJobs(): Job[] {
  const older = olderSeeds()
  const extra = random(99)
  return [...SEEDS, ...older, ...pastApplications()].map((s, i) => {
    const source = s.source ?? 'jobstreet'
    const external_id = String(90_000_000 + i * 7919)
    const path = s.path ?? statusPath(s.status ?? 'new').map(([, to, after]): [JobStatus, number] => [to, after])
    paths.set(external_id, path)
    const firstSeen = Date.now() - s.hoursAgo * HOUR
    const atHours = (hours: number | undefined) =>
      hours === undefined ? null : new Date(firstSeen + hours * HOUR).toISOString()
    // Like the database: applied_at at the first applied-or-later stage, the
    // response at the first exam/interview/offer/rejection after it.
    const appliedHours = path.find(([status]) => APPLIED_STAGES.includes(status))?.[1]
    const responseHours = appliedHours === undefined ? undefined
      : path.find(([status, after]) => RESPONSE_STAGES.includes(status) && after > appliedHours)?.[1]
    const applied = appliedHours !== undefined
    // The older jobs get attributes like a real backlog: some set, some left unknown.
    const role: RoleType = s.role ?? (applied && extra() < 0.6 ? (extra() < 0.7 ? 'web' : 'ai') : 'unknown')
    const resume = s.resume ?? (role === 'unknown' ? 'unknown' : role === 'ai' ? 'ai' : 'web')
    const channel: ApplicationChannel = s.channel
      ?? (!applied ? 'unknown' : path.some(([status]) => status === 'emailed') ? 'direct_message' : 'job_board')
    return {
      source,
      external_id,
      title: s.title,
      company: s.company,
      location: s.location,
      work_arrangements: s.arrangements,
      work_type: 'Full time',
      salary_text: s.salary ?? null,
      seniority: null,
      posted_at: ago(s.hoursAgo + 4),
      apply_type: 'Job board',
      apply_link: null,
      match_score: s.score,
      matched_skills: s.skills,
      missing_skills: s.missing ?? [],
      flags: s.flags ?? [],
      emails: s.email ? [s.email] : [],
      email_source: s.email ? 'description' : null,
      url: `https://example.com/jobs/${slug(s.title)}-${external_id}`,
      search_terms: ['junior developer'],
      status: s.status ?? 'new',
      status_changed_at: path.length ? ago(Math.max(0.5, s.hoursAgo - path.at(-1)![1])) : null,
      skip_reason: s.status === 'skip' ? 'training bond' : null,
      notes: s.notes ?? null,
      email_drafted_at: s.status === 'emailed' ? ago(s.hoursAgo - 1) : null,
      first_seen: ago(s.hoursAgo),
      channel,
      resume_version: resume,
      role_type: role,
      work_setup: guessWorkSetup(s.arrangements, s.location),
      applied_at: atHours(appliedHours),
      first_response_at: atHours(responseHours),
    }
  })
}

export function demoDescription(job: Job): string {
  return [
    `${job.company} is hiring a ${job.title} to join our growing product team.`,
    '',
    'What you will do:',
    '- Build and maintain features across our web applications',
    '- Work with designers and senior engineers in code reviews',
    '- Write tests and help keep our services reliable',
    '',
    'What we are looking for:',
    `- Familiarity with ${job.matched_skills.slice(0, 3).join(', ') || 'modern web tools'}`,
    '- Good communication skills and willingness to learn',
    job.flags.includes('+fresh grads OK') ? '- Fresh graduates are welcome to apply' : '- 1–2 years of experience is a plus',
    '',
    '(Sample data: this listing is made up for the demo.)',
  ].join('\n')
}

const FILTERED_SEEDS: [string, string, string, string[], string, number][] = [
  ['Senior Software Engineer', 'Lumen Labs', 'Cebu City, Cebu', ['Hybrid'], 'seniority title (Senior)', 4],
  ['Tech Lead – Platform', 'Harbor Systems', 'Cebu City, Cebu', ['On-site'], 'seniority title (Lead)', 6],
  ['IT Support Specialist', 'Blue Coral Tech', 'Mandaue City, Cebu', ['On-site'], 'non-dev / IT role (IT Support)', 9],
  ['Software Developer Intern', 'Orbit Apps', 'Cebu City, Cebu', ['On-site'], 'internship (Intern)', 12],
  ['Frontend Developer', 'Atlas Retail', 'Makati, Metro Manila', ['On-site'], 'On-site outside Cebu', 15],
  ['Java Developer', 'Granite Bank', 'Taguig, Metro Manila', ['Hybrid'], 'Hybrid outside Cebu', 18],
  ['Junior Developer (Night Shift)', 'Nightjar BPO', 'Cebu City, Cebu', ['On-site'], 'night shift (night shift)', 22],
  ['Software Engineer', 'Vertex Cloud', 'Cebu City, Cebu', ['Remote'], '5+ years experience', 30],
  ['PHP Developer', 'Pixel & Pine', 'Cebu City, Cebu', ['On-site'], 'low skill match (score 1)', 33],
  ['WordPress Developer', 'Content Forge', 'Cebu City, Cebu', ['Remote'], 'design/content role (WordPress)', 40],
  ['Senior Data Engineer', 'Datasmith PH', 'Cebu City, Cebu', ['Hybrid'], 'seniority title (Senior)', 48],
  ['Customer Support Engineer', 'Helio Telecom', 'Cebu City, Cebu', ['On-site'], 'support role (Support Engineer)', 60],
]

export function demoFilteredJobs(): FilteredJob[] {
  return FILTERED_SEEDS.map(([title, company, location, arrangements, reason, hoursAgo], i) => {
    const external_id = String(80_000_000 + i * 6007)
    return {
      source: 'jobstreet',
      external_id,
      title,
      company,
      location,
      work_arrangements: arrangements,
      search_terms: ['junior developer'],
      reason,
      url: `https://example.com/jobs/${slug(title)}-${external_id}`,
      first_seen: ago(hoursAgo),
    }
  })
}

// Repeatable pseudo-random numbers, so the demo looks the same on every load.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Two weeks of runs at the default times (11:00 and 15:00), newest first.
 * One run failed and one was cancelled, so the health panel has something to show.
 */
export function demoScrapeRuns(): ScrapeRun[] {
  const rand = random(7)
  return Array.from({ length: 28 }, (_, i) => {
    const start = 3.1 + Math.floor(i / 2) * 24 + (i % 2) * 20
    const failed = i === 9
    const interrupted = i === 16
    const done = !failed && !interrupted
    const found = 110 + Math.round(rand() * 60)
    const evaluated = Math.round(found * (0.15 + rand() * 0.2))
    const kept = Math.round(evaluated * (0.1 + rand() * 0.15))
    const expired = Math.round(rand() * 2)
    // One run's re-check of closed postings failed after its jobs were saved.
    const warning = i === 4 ? 'Closed-posting re-check failed: HTTP 503 from the job board' : null
    return {
      source: 'jobstreet' as const,
      status: failed ? 'failed' as const : interrupted ? 'interrupted' as const : 'ok' as const,
      warning,
      dispatch_id: null,
      started_at: ago(start),
      finished_at: interrupted ? null : ago(start - 0.05),
      found: done ? found : null,
      evaluated: done ? evaluated : null,
      kept: done ? kept : null,
      filtered: done ? evaluated - kept - expired : null,
      expired: done ? expired : null,
      error: failed ? 'RuntimeError: Every search failed; the site may be blocking requests or changed its API.' : null,
      github_run_id: null,
      settings_version: 1,
    }
  })
}

/** The latest run (the demo has one source). */
export const demoLatestRuns = () => demoScrapeRuns().slice(0, 1)

/**
 * The status changes behind each demo job's current status, oldest first. Like
 * rows written before Undo existed: no snapshots, so they can't be undone.
 */
export function demoStatusHistory(jobs: Job[]): StatusChange[] {
  return jobs
    .flatMap((job) =>
      (paths.get(job.external_id) ?? []).map(([to, afterHours], i, path): Omit<StatusChange, 'id'> => ({
        job_source: job.source,
        job_external_id: job.external_id,
        // A logged application starts at its stage, as the database's insert trigger records it.
        from_status: i > 0 ? path[i - 1][0] : job.source === 'manual' ? null : 'new',
        to_status: to,
        changed_at: new Date(Date.parse(job.first_seen) + afterHours * HOUR).toISOString(),
        kind: 'change',
        reverted_at: null,
        undoable: false,
      })),
    )
    .filter((change) => Date.parse(change.changed_at) <= Date.now())
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
    .map((change, i) => ({ ...change, id: i + 1 }))
}

/** How a job got to its status: [from, to, hours after it was first seen]. */
function statusPath(status: JobStatus): [JobStatus, JobStatus, number][] {
  switch (status) {
    case 'new': return []
    case 'applied': return [['new', 'applied', 2]]
    case 'emailed': return [['new', 'emailed', 1]]
    case 'exam': return [['new', 'applied', 2], ['applied', 'exam', 60]]
    case 'skip': return [['new', 'skip', 2]]
    case 'interview': return [['new', 'applied', 2], ['applied', 'interview', 54]]
    case 'rejected': return [['new', 'applied', 3], ['applied', 'rejected', 50]]
    case 'offer': return [['new', 'applied', 2], ['applied', 'interview', 70], ['interview', 'offer', 170]]
    case 'withdrawn': return [['new', 'applied', 2], ['applied', 'withdrawn', 80]]
    case 'expired': return [['new', 'expired', 15 * 24]]
  }
}
