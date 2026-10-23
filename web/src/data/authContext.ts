import { createContext, useContext } from 'react'
import type { AppUser } from './types'

export interface AuthState {
  /** undefined while the saved session is still loading */
  user: AppUser | null | undefined
}

export const AuthContext = createContext<AuthState>({ user: undefined })

export const useAuth = () => useContext(AuthContext)
