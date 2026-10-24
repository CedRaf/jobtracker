import { Flex, Tag, theme, Tooltip } from 'antd'
import type { CSSProperties, ReactNode } from 'react'
import type { JobStatus } from '../data/types'
import { entryReason, type EntryLevel } from '../lib/entryLevel'
import { FLAG_COLORS, flagLabel, flagTone } from '../lib/flags'
import { STATUS_META } from '../lib/status'

/**
 * A tag in one of antd's preset colours, with stronger text than antd's own
 * presets (shade 8 on shade 1) so it passes WCAG AA. Dark mode's preset
 * palettes run from dark to light, so the same shades work there too.
 */
export function ToneTag({ color, children, style }: { color?: string; children: ReactNode; style?: CSSProperties }) {
  const { token } = theme.useToken()
  const shade = (n: number) => (token as unknown as Record<string, string>)[`${color}${n}`]
  const tone = !color || color === 'default' || !shade(8)
    ? { color: token.colorTextSecondary, background: token.colorFillQuaternary, borderColor: token.colorBorderSecondary }
    : { color: shade(8), background: shade(1), borderColor: shade(3) }
  return <Tag style={{ marginInlineEnd: 0, ...tone, ...style }}>{children}</Tag>
}

/** Marks a job that takes juniors or fresh grads; hover for why. */
export function EntryLevelTag({ level }: { level: EntryLevel }) {
  if (!level) return null
  return (
    <Tooltip title={entryReason(level)}>
      <span><ToneTag color="green" style={{ whiteSpace: 'nowrap' }}>Entry-level</ToneTag></span>
    </Tooltip>
  )
}

export const StatusTag = ({ status }: { status: JobStatus }) => (
  <ToneTag color={STATUS_META[status].color}>{STATUS_META[status].label}</ToneTag>
)

export function FlagTags({ flags }: { flags: string[] }) {
  if (!flags.length) return null
  return (
    <Flex wrap gap={4}>
      {flags.map((flag) => (
        <ToneTag key={flag} color={FLAG_COLORS[flagTone(flag)]}>{flagLabel(flag)}</ToneTag>
      ))}
    </Flex>
  )
}

/** Skill tags; `max` collapses the rest into "+N". */
export function SkillTags({ skills, color, max }: { skills: string[]; color?: string; max?: number }) {
  if (!skills.length) return null
  const shown = max ? skills.slice(0, max) : skills
  const hidden = skills.length - shown.length
  return (
    <Flex wrap gap={4}>
      {shown.map((skill) => <ToneTag key={skill} color={color}>{skill}</ToneTag>)}
      {hidden > 0 && <ToneTag>+{hidden}</ToneTag>}
    </Flex>
  )
}
