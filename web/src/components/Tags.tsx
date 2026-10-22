import { Flex, Tag } from 'antd'
import type { JobStatus } from '../data/types'
import { FLAG_COLORS, flagLabel, flagTone } from '../lib/flags'
import { STATUS_META } from '../lib/status'

export const StatusTag = ({ status }: { status: JobStatus }) => (
  <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
)

export function FlagTags({ flags }: { flags: string[] }) {
  if (!flags.length) return null
  return (
    <Flex wrap gap={4}>
      {flags.map((flag) => (
        <Tag key={flag} color={FLAG_COLORS[flagTone(flag)]} style={{ marginInlineEnd: 0 }}>
          {flagLabel(flag)}
        </Tag>
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
      {shown.map((skill) => (
        <Tag key={skill} color={color} style={{ marginInlineEnd: 0 }}>{skill}</Tag>
      ))}
      {hidden > 0 && <Tag style={{ marginInlineEnd: 0 }}>+{hidden}</Tag>}
    </Flex>
  )
}
