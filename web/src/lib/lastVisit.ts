import { createContext, useEffect } from 'react'

const KEY = 'jobtracker.lastVisit'

/**
 * A visit ends after this long without the page open. Reloads and quick app
 * switches stay inside one visit; scrapes are hours apart.
 */
export const VISIT_GAP_MS = 30 * 60_000

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>

interface VisitRecord {
  /** When the previous visit ended: the cut-off for "new" in this one. */
  since: string | null
  /** The last time this visit had the page open. */
  lastSeen: string
}

/** When the previous visit was (for "new" badges); fixed for the whole page load. */
export const LastVisitContext = createContext<string | null>(null)

function read(storage: VisitStorage | undefined): VisitRecord | null {
  const raw = storage?.getItem(KEY) ?? null
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as VisitRecord
    if (typeof record.lastSeen === 'string') return record
  } catch {
    // older versions stored the bare time of the last page load
  }
  return { since: raw, lastSeen: raw }
}

/**
 * Starts or continues a visit and returns the cut-off for "new" (ISO time),
 * or null on a first visit or when storage is unavailable. Call once per page
 * load, so the "new" badges stay put while you work.
 */
export function startVisit(storage: VisitStorage | undefined, now = new Date()) {
  try {
    const previous = read(storage)
    const sameVisit = previous && now.getTime() - Date.parse(previous.lastSeen) < VISIT_GAP_MS
    const since = previous ? (sameVisit ? previous.since : previous.lastSeen) : null
    storage?.setItem(KEY, JSON.stringify({ since, lastSeen: now.toISOString() }))
    return since
  } catch {
    return null
  }
}

/** Notes that the page is still open, keeping the current visit going. */
export function touchVisit(storage: VisitStorage | undefined, now = new Date()) {
  try {
    const current = read(storage)
    storage?.setItem(KEY, JSON.stringify({ since: current?.since ?? null, lastSeen: now.toISOString() }))
  } catch {
    // not remembered: the next load starts a new visit a little early
  }
}

/** Keeps the visit's end time current while the page is open and when it's hidden or closed. */
export function useTrackVisit() {
  useEffect(() => {
    const touch = () => touchVisit(typeof localStorage === 'undefined' ? undefined : localStorage)
    const timer = setInterval(() => document.visibilityState === 'visible' && touch(), 60_000)
    document.addEventListener('visibilitychange', touch)
    window.addEventListener('pagehide', touch)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', touch)
      window.removeEventListener('pagehide', touch)
    }
  }, [])
}
