import { useEffect, useState, type ReactNode } from 'react'
import { useIsRestoring, useQueryClient } from '@tanstack/react-query'
import { AuthContext } from './authContext'
import { useApi } from './hooks'
import type { AppUser } from './types'

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const isRestoring = useIsRestoring()
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)

  // Signed out (or the session expired): drop all data, which also empties the
  // saved cache. Waits for the saved cache to finish loading, so it can't come back after.
  useEffect(() => {
    if (user === null && !isRestoring) queryClient.clear()
  }, [user, isRestoring, queryClient])

  useEffect(() => {
    let active = true
    api.auth.getUser().then((u) => active && setUser(u))
    const unsubscribe = api.auth.onChange((u) => setUser(u))
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
}
