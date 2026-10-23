import { createDemoApi } from './demoApi'
import { createSupabaseApi } from './supabaseApi'
import type { DataApi } from './types'

const env = import.meta.env

/**
 * The one place that decides where data comes from. Components use the hooks
 * in hooks.ts, never Supabase directly, so demo mode needs no other changes.
 * Returns null when Supabase isn't configured (see .env.example).
 */
function createApi(): DataApi | null {
  // `npm run dev:demo` / `build:demo` use mode "demo".
  if (env.VITE_DEMO === 'true' || env.MODE === 'demo') return createDemoApi()
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) return null
  return createSupabaseApi(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
}

export const api = createApi()
