import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useApi } from './hooks'
import type { AppUser } from './types'

interface AuthState {
  /** undefined while the saved session is still loading */
  user: AppUser | null | undefined
}

const AuthContext = createContext<AuthState>({ user: undefined })

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const [user, setUser] = useState<AppUser | null | undefined>(undefined)

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

export const useAuth = () => useContext(AuthContext)
