import { expect, it } from 'vitest'
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client'
import { CACHE_STORAGE_KEY, createQueryClient, persistOptions } from './queryCache'

function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() { return items.size },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => { items.delete(k) },
    setItem: (k, v) => { items.set(k, v) },
  }
}

it('saves the cache without job descriptions and restores it in a new session', async () => {
  const storage = memoryStorage()
  const before = createQueryClient()
  before.setQueryData(['jobs'], [{ title: 'Junior developer' }])
  before.setQueryData(['description', 'linkedin:1'], 'A long description')
  await persistQueryClientSave({ queryClient: before, ...persistOptions(storage) })
  // The async persister writes after a short throttle.
  await new Promise((r) => setTimeout(r, 1100))
  expect(storage.getItem(CACHE_STORAGE_KEY)).toContain('Junior developer')
  expect(storage.getItem(CACHE_STORAGE_KEY)).not.toContain('A long description')

  const after = createQueryClient()
  await persistQueryClientRestore({ queryClient: after, ...persistOptions(storage) })
  expect(after.getQueryData(['jobs'])).toEqual([{ title: 'Junior developer' }])
  expect(after.getQueryData(['description', 'linkedin:1'])).toBeUndefined()
})

it('throws away a saved cache from an older version of the app', async () => {
  const storage = memoryStorage()
  const before = createQueryClient()
  before.setQueryData(['jobs'], [{ title: 'Old shape' }])
  await persistQueryClientSave({ queryClient: before, ...persistOptions(storage), buster: 'old' })
  await new Promise((r) => setTimeout(r, 1100))

  const after = createQueryClient()
  await persistQueryClientRestore({ queryClient: after, ...persistOptions(storage) })
  expect(after.getQueryData(['jobs'])).toBeUndefined()
})
