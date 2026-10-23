import { Grid, theme } from 'antd'
import type { Job, JobStatus } from '../data/types'
import { isNewSince } from '../lib/filters'

interface Stat {
  key: string
  title: string
  statuses?: JobStatus[]
  newOnly?: boolean
}

// "To review" leads: it's the daily job. The rest are the pipeline after it.
const STATS: Stat[] = [
  { key: 'to-review', title: 'To review', statuses: ['new'] },
  { key: 'new-since', title: 'New since last visit', newOnly: true },
  { key: 'applied', title: 'Applied / emailed', statuses: ['applied', 'emailed'] },
  { key: 'interview', title: 'Interviewing', statuses: ['interview'] },
  { key: 'offer', title: 'Offers', statuses: ['offer'] },
]

interface Props {
  jobs: Job[]
  lastVisit: string | null
  /** The stat matching the current filters, if any. */
  activeKey: string | null
  onSelect: (selection: { key: string; statuses?: JobStatus[]; newOnly?: boolean } | null) => void
}

/** Counts for the current tab; each one filters the table to it (press again to clear). */
export function StatCards({ jobs, lastVisit, activeKey, onSelect }: Props) {
  const { token } = theme.useToken()
  const screens = Grid.useBreakpoint()
  const count = (stat: Stat) =>
    stat.newOnly
      ? jobs.filter((j) => isNewSince(j, lastVisit)).length
      : jobs.filter((j) => stat.statuses!.includes(j.status)).length

  return (
    <div role="group" aria-label="Quick filters"
      style={{
        display: 'flex', gap: 8,
        // Phones scroll the row sideways instead of stacking it down the screen.
        overflowX: screens.md ? undefined : 'auto', flexWrap: screens.md ? 'wrap' : 'nowrap',
        marginInline: screens.md ? 0 : -16, paddingInline: screens.md ? 0 : 16, scrollbarWidth: 'none',
      }}>
      {STATS.map((stat, i) => {
        const active = activeKey === stat.key
        const lead = i === 0
        return (
          <button
            key={stat.key}
            type="button"
            className="stat-toggle"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : stat)}
            style={{
              flex: screens.md ? (lead ? '1.4 1 0' : '1 1 0') : '0 0 auto',
              minWidth: screens.md ? 140 : undefined,
              display: 'flex', flexDirection: screens.md ? 'column' : 'row',
              alignItems: screens.md ? 'flex-start' : 'baseline', gap: screens.md ? 2 : 6,
              padding: screens.md ? '10px 14px' : '6px 12px',
              borderRadius: token.borderRadiusLG, cursor: 'pointer', textAlign: 'left', font: 'inherit',
              border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
              background: active ? token.colorPrimaryBg : token.colorBgContainer,
              color: token.colorText,
            }}
          >
            <span className="tabular" style={{
              fontSize: screens.md ? (lead ? 28 : 22) : 16, lineHeight: 1.2, fontWeight: 600,
              color: active ? token.colorPrimaryText : token.colorText,
            }}>
              {count(stat)}
            </span>
            <span style={{ fontSize: 13, color: active ? token.colorPrimaryText : token.colorTextSecondary, whiteSpace: 'nowrap' }}>
              {stat.title}
            </span>
          </button>
        )
      })}
    </div>
  )
}
