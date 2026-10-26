// Made-up sample data for demo mode. No real listings or companies.
// One job site only, with a generic name: the public demo doesn't show real site names.
import type { FilteredJob, Job, JobStatus, ScrapeRun, StatusChange } from './types'

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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function demoJobs(): Job[] {
  return [...SEEDS, ...olderSeeds()].map((s, i) => {
    const source = s.source ?? 'jobstreet'
    const external_id = String(90_000_000 + i * 7919)
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
      status_changed_at: s.status && s.status !== 'new'
        ? ago(Math.max(0.5, s.hoursAgo - statusPath(s.status).at(-1)![2]))
        : null,
      skip_reason: s.status === 'skip' ? 'training bond' : null,
      notes: s.notes ?? null,
      email_drafted_at: s.status === 'emailed' ? ago(s.hoursAgo - 1) : null,
      first_seen: ago(s.hoursAgo),
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
 * Two weeks of runs on the real schedule (11:00 and 15:00), newest first.
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
    return {
      source: 'jobstreet' as const,
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

/** The status changes behind each demo job's current status, oldest first. */
export function demoStatusHistory(jobs: Job[]): StatusChange[] {
  return jobs
    .flatMap((job) =>
      statusPath(job.status).map(([from, to, afterHours]) => ({
        job_source: job.source,
        job_external_id: job.external_id,
        from_status: from,
        to_status: to,
        changed_at: new Date(Date.parse(job.first_seen) + afterHours * HOUR).toISOString(),
      })),
    )
    .filter((change) => Date.parse(change.changed_at) <= Date.now())
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
}

/** How a job got to its status: [from, to, hours after it was first seen]. */
function statusPath(status: JobStatus): [JobStatus, JobStatus, number][] {
  switch (status) {
    case 'new': return []
    case 'applied': return [['new', 'applied', 2]]
    case 'emailed': return [['new', 'emailed', 1]]
    case 'skip': return [['new', 'skip', 2]]
    case 'interview': return [['new', 'applied', 2], ['applied', 'interview', 54]]
    case 'rejected': return [['new', 'applied', 3], ['applied', 'rejected', 50]]
    case 'offer': return [['new', 'applied', 2], ['applied', 'interview', 70], ['interview', 'offer', 170]]
  }
}
