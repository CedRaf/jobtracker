import { createClient, type User } from '@supabase/supabase-js'
import type { AppUser, DataApi, FilteredJob, Job, JobKey, ScrapeRun, SettingsVersion, StatusChange } from './types'

// Everything except the description, which is only loaded for the open job.
const JOB_COLUMNS = [
  'source', 'external_id', 'title', 'company', 'location', 'work_arrangements', 'work_type',
  'salary_text', 'seniority', 'posted_at', 'apply_type', 'apply_link', 'match_score',
  'matched_skills', 'missing_skills', 'flags', 'emails', 'email_source', 'url', 'search_terms',
  'status', 'status_changed_at', 'skip_reason', 'notes', 'email_drafted_at', 'first_seen',
].join(',')

const FILTERED_COLUMNS =
  'source,external_id,title,company,location,work_arrangements,search_terms,reason,url,first_seen'

const RUN_COLUMNS =
  'source,started_at,finished_at,found,evaluated,kept,filtered,expired,error,github_run_id,settings_version'

const SETTINGS_COLUMNS = 'version,settings,note,created_at'

const HISTORY_COLUMNS = 'job_source,job_external_id,from_status,to_status,changed_at'

// PostgREST returns at most 1000 rows per request by default.
const PAGE = 1000

/** The first (newest) run of each source, from runs sorted newest first. */
export const latestPerSource = (runs: ScrapeRun[]) =>
  runs.filter((run, i) => runs.findIndex((r) => r.source === run.source) === i)

const toUser = (user: User | null | undefined): AppUser | null =>
  user ? { id: user.id, email: user.email ?? null } : null

export function createSupabaseApi(url: string, publishableKey: string): DataApi {
  const supabase = createClient(url, publishableKey)

  async function fetchAll<T>(
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: Error | null }>,
  ): Promise<T[]> {
    const rows: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await page(from, from + PAGE - 1)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) return rows
    }
  }

  const byKey = (key: JobKey) => ({ source: key.source, external_id: key.external_id })

  return {
    demo: false,
    sources: ['jobstreet', 'linkedin', 'himalayas'],
    sourceLabels: { jobstreet: 'JobStreet', linkedin: 'LinkedIn', himalayas: 'Himalayas' },

    listJobs: () =>
      fetchAll<Job>((from, to) =>
        supabase
          .from('jobs')
          .select(JOB_COLUMNS)
          .order('first_seen', { ascending: false })
          .range(from, to)
          .returns<Job[]>(),
      ),

    async getDescription(key) {
      const { data, error } = await supabase
        .from('jobs')
        .select('description')
        .match(byKey(key))
        .maybeSingle<{ description: string | null }>()
      if (error) throw error
      return data?.description ?? null
    },

    async updateJob(key, patch) {
      const { data, error } = await supabase
        .from('jobs')
        .update(patch)
        .match(byKey(key))
        .select(JOB_COLUMNS)
        .single<Job>()
      if (error) throw error
      return data
    },

    listFilteredJobs(days) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      return fetchAll<FilteredJob>((from, to) =>
        supabase
          .from('filtered_jobs')
          .select(FILTERED_COLUMNS)
          .gte('first_seen', since)
          .order('first_seen', { ascending: false })
          .range(from, to)
          .returns<FilteredJob[]>(),
      )
    },

    async latestScrapeRuns() {
      // Two sources, so the newest few rows always include both.
      const { data, error } = await supabase
        .from('scrape_runs')
        .select(RUN_COLUMNS)
        .order('started_at', { ascending: false })
        .limit(10)
        .returns<ScrapeRun[]>()
      if (error) throw error
      return latestPerSource(data ?? [])
    },

    listScrapeRuns(days) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      return fetchAll<ScrapeRun>((from, to) =>
        supabase
          .from('scrape_runs')
          .select(RUN_COLUMNS)
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .range(from, to)
          .returns<ScrapeRun[]>(),
      )
    },

    async listSettingsVersions() {
      const { data, error } = await supabase
        .from('scraper_settings_versions')
        .select(SETTINGS_COLUMNS)
        .order('version', { ascending: false })
        .limit(50)
        .returns<SettingsVersion[]>()
      if (error) throw error
      return data ?? []
    },

    async saveSettings(settings, note) {
      const { data, error } = await supabase
        .from('scraper_settings_versions')
        .insert({ settings, note })
        .select(SETTINGS_COLUMNS)
        .single<SettingsVersion>()
      if (error) throw error
      return data
    },

    listStatusHistory: () =>
      fetchAll<StatusChange>((from, to) =>
        supabase
          .from('status_history')
          .select(HISTORY_COLUMNS)
          .order('changed_at', { ascending: true })
          .range(from, to)
          .returns<StatusChange[]>(),
      ),

    auth: {
      async getUser() {
        const { data } = await supabase.auth.getSession()
        return toUser(data.session?.user)
      },
      onChange(callback) {
        const { data } = supabase.auth.onAuthStateChange((_event, session) =>
          callback(toUser(session?.user)),
        )
        return () => data.subscription.unsubscribe()
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        await supabase.auth.signOut()
      },
      async isAppUser() {
        const { data, error } = await supabase.rpc('is_app_user')
        if (error) throw error
        return data === true
      },
    },
  }
}
