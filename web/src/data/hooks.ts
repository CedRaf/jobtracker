import { createContext, useContext } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DataApi, Job, JobKey, JobPatch, JobSource, ScraperSettings } from './types'
import { jobKeyString } from './types'

export const ApiContext = createContext<DataApi | null>(null)

/** The job sites this deployment shows, in display order. */
export const useSources = () => useApi().sources

/**
 * How to name a job's site. `multi` is false when the deployment shows a
 * single site (the public demo): the UI then leaves the site name out.
 */
export function useSourceLabel() {
  const api = useApi()
  return { multi: api.sources.length > 1, label: (source: JobSource) => api.sourceLabels[source] }
}

export function useApi(): DataApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside <ApiContext.Provider>')
  return api
}

const JOBS = ['jobs'] as const

export function useJobs() {
  const api = useApi()
  return useQuery({ queryKey: JOBS, queryFn: () => api.listJobs() })
}

export function useJobDescription(key: JobKey | null) {
  const api = useApi()
  return useQuery({
    queryKey: ['description', key && jobKeyString(key)],
    queryFn: () => api.getDescription(key!),
    enabled: key !== null,
    staleTime: Infinity, // descriptions never change after scraping
  })
}

/** Updates a job, showing the change immediately and rolling back on error. */
export function useUpdateJob() {
  const api = useApi()
  const queryClient = useQueryClient()
  const sameJob = (key: JobKey) => (j: Job) =>
    j.source === key.source && j.external_id === key.external_id

  return useMutation({
    mutationFn: ({ key, patch }: { key: JobKey; patch: JobPatch }) => api.updateJob(key, patch),
    onMutate: async ({ key, patch }) => {
      await queryClient.cancelQueries({ queryKey: JOBS })
      const previous = queryClient.getQueryData<Job[]>(JOBS)
      queryClient.setQueryData<Job[]>(JOBS, (jobs) =>
        jobs?.map((j) => (sameJob(key)(j) ? { ...j, ...patch } : j)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(JOBS, context.previous)
    },
    onSuccess: (saved, { key, patch }) => {
      queryClient.setQueryData<Job[]>(JOBS, (jobs) =>
        jobs?.map((j) => (sameJob(key)(j) ? saved : j)),
      )
      // A status change adds a row to status_history (the analytics read it).
      if (patch.status) queryClient.invalidateQueries({ queryKey: HISTORY })
    },
  })
}

export function useLatestScrapeRuns() {
  const api = useApi()
  return useQuery({ queryKey: ['scrapeRuns', 'latest'], queryFn: () => api.latestScrapeRuns() })
}

export function useScrapeRuns(days: number) {
  const api = useApi()
  return useQuery({ queryKey: ['scrapeRuns', days], queryFn: () => api.listScrapeRuns(days) })
}

const SETTINGS = ['settingsVersions'] as const

export function useSettingsVersions() {
  const api = useApi()
  return useQuery({ queryKey: SETTINGS, queryFn: () => api.listSettingsVersions() })
}

export function useSaveSettings() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ settings, note }: { settings: ScraperSettings; note: string | null }) =>
      api.saveSettings(settings, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS }),
  })
}

const HISTORY = ['statusHistory'] as const

export function useStatusHistory() {
  const api = useApi()
  return useQuery({ queryKey: HISTORY, queryFn: () => api.listStatusHistory() })
}

export function useFilteredJobs(days: number) {
  const api = useApi()
  return useQuery({ queryKey: ['filtered', days], queryFn: () => api.listFilteredJobs(days) })
}
