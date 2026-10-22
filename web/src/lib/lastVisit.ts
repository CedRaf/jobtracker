import { createContext } from 'react'

const KEY = 'jobtracker.lastVisit'

/** When the previous visit was (for "new" badges); fixed for the whole page load. */
export const LastVisitContext = createContext<string | null>(null)

/**
 * Records this visit and returns the previous one (ISO time), or null on a
 * first visit or when storage is unavailable. Call once per page load, so the
 * "new" badges stay put while you work.
 */
export function startVisit(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, now = new Date()) {
  try {
    const previous = storage?.getItem(KEY) ?? null
    storage?.setItem(KEY, now.toISOString())
    return previous
  } catch {
    return null
  }
}
