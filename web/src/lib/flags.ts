// The scraper prefixes flags with "!" (a concern) or "+" (a good sign).

export type FlagTone = 'warning' | 'positive' | 'neutral'

export function flagTone(flag: string): FlagTone {
  if (flag.startsWith('!')) return 'warning'
  if (flag.startsWith('+')) return 'positive'
  return 'neutral'
}

export const flagLabel = (flag: string) => flag.replace(/^[!+]/, '')

export const FLAG_COLORS: Record<FlagTone, string> = {
  warning: 'orange',
  positive: 'green',
  neutral: 'default',
}
