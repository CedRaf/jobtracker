import { QueryClient, type Query } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'

/**
 * How long a saved cache is shown on the next visit. The scraper runs twice a
 * day, so the saved jobs are usually still current; either way every query is
 * refetched in the background as soon as the page opens.
 */
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

/** Bump when the shape of cached data changes, so old saved caches are thrown away. */
export const CACHE_VERSION = '1'

export const CACHE_STORAGE_KEY = 'jobtracker:query-cache'

export function createQueryClient() {
  return new QueryClient({
    // gcTime has to cover CACHE_MAX_AGE, or queries leave memory (and so the saved cache) early.
    defaultOptions: { queries: { staleTime: 60_000, gcTime: CACHE_MAX_AGE, refetchOnWindowFocus: true, retry: 1 } },
  })
}

/**
 * Descriptions are left out: they're fetched one job at a time, add up to most of
 * the size, and localStorage is small. Everything else is a handful of lists.
 */
export const shouldPersistQuery = (query: Query) =>
  query.state.status === 'success' && query.queryKey[0] !== 'description'

/** Saves the query cache to localStorage, so a reload shows the last data at once. */
export function persistOptions(storage: Storage | undefined): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: createAsyncStoragePersister({ storage, key: CACHE_STORAGE_KEY }),
    maxAge: CACHE_MAX_AGE,
    buster: CACHE_VERSION,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  }
}
