import { createContext, useContext } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DataApi, Job, JobKey, JobPatch } from './types'
import { jobKeyString } from './types'

export const ApiContext = createContext<DataApi | null>(null)

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
    onSuccess: (saved, { key }) => {
      queryClient.setQueryData<Job[]>(JOBS, (jobs) =>
        jobs?.map((j) => (sameJob(key)(j) ? saved : j)),
      )
    },
  })
}

export function useLatestScrapeRuns() {
  const api = useApi()
  return useQuery({ queryKey: ['scrapeRuns'], queryFn: () => api.latestScrapeRuns() })
}

export function useFilteredJobs(days: number) {
  const api = useApi()
  return useQuery({ queryKey: ['filtered', days], queryFn: () => api.listFilteredJobs(days) })
}
