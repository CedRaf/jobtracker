// Mirrors supabase/migrations/*_init.sql. Keep the two in sync.

export type JobSource = 'jobstreet' | 'linkedin'

export type JobStatus =
  | 'new'
  | 'applied'
  | 'emailed'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'skip'

export interface JobKey {
  source: JobSource
  external_id: string
}

/** A kept job, without its (large) description; see DataApi.getDescription. */
export interface Job extends JobKey {
  title: string
  company: string | null
  location: string | null
  work_arrangements: string[]
  work_type: string | null
  salary_text: string | null
  seniority: string | null
  posted_at: string | null
  apply_type: string | null
  apply_link: string | null
  match_score: number
  matched_skills: string[]
  missing_skills: string[]
  flags: string[]
  emails: string[]
  email_source: string | null
  url: string
  search_terms: string[]
  status: JobStatus
  status_changed_at: string | null
  skip_reason: string | null
  notes: string | null
  email_drafted_at: string | null
  first_seen: string
}

/** The columns the dashboard may change (the database only grants these). */
export type JobPatch = Partial<Pick<Job, 'status' | 'skip_reason' | 'notes' | 'email_drafted_at'>>

export interface FilteredJob extends JobKey {
  title: string
  company: string | null
  location: string | null
  work_arrangements: string[]
  search_terms: string[]
  reason: string
  url: string
  first_seen: string
}

/** One scraper run for one source (the scrape_runs table, trimmed). */
export interface ScrapeRun {
  source: JobSource
  started_at: string
  finished_at: string | null
  kept: number | null
  /** Null = the run succeeded. */
  error: string | null
}

export interface AppUser {
  id: string
  email: string | null
}

export interface DataApi {
  /** True when running on built-in sample data instead of Supabase. */
  demo: boolean
  listJobs(): Promise<Job[]>
  getDescription(key: JobKey): Promise<string | null>
  updateJob(key: JobKey, patch: JobPatch): Promise<Job>
  /** Filtered-out jobs first seen in the last `days` days. */
  listFilteredJobs(days: number): Promise<FilteredJob[]>
  /** The most recent run for each source (at most one per source). */
  latestScrapeRuns(): Promise<ScrapeRun[]>
  auth: {
    getUser(): Promise<AppUser | null>
    /** Calls back on sign-in/out; returns an unsubscribe function. */
    onChange(callback: (user: AppUser | null) => void): () => void
    signIn(email: string, password: string): Promise<void>
    signOut(): Promise<void>
    /** Whether the signed-in user is listed in app_users (and so can see data). */
    isAppUser(): Promise<boolean>
  }
}

export const jobKeyString = (key: JobKey) => `${key.source}:${key.external_id}`
