import { Card, Col, Row, Statistic, theme } from 'antd'
import type { Job, JobStatus } from '../data/types'
import { isNewSince } from '../lib/filters'

interface Stat {
  key: string
  title: string
  statuses?: JobStatus[]
  newOnly?: boolean
  color: string
}

const STATS: Stat[] = [
  { key: 'new-since', title: 'New since last visit', newOnly: true, color: '#4f46e5' },
  { key: 'to-review', title: 'To review', statuses: ['new'], color: '#2563eb' },
  { key: 'applied', title: 'Applied / emailed', statuses: ['applied', 'emailed'], color: '#0891b2' },
  { key: 'interview', title: 'Interviewing', statuses: ['interview'], color: '#7c3aed' },
  { key: 'offer', title: 'Offers', statuses: ['offer'], color: '#059669' },
]

interface Props {
  jobs: Job[]
  lastVisit: string | null
  /** The card matching the current filters, if any. */
  activeKey: string | null
  onSelect: (selection: { key: string; statuses?: JobStatus[]; newOnly?: boolean } | null) => void
}

/** Counts for the current tab; clicking a card filters the table to it (click again to clear). */
export function StatCards({ jobs, lastVisit, activeKey, onSelect }: Props) {
  const { token } = theme.useToken()
  const count = (stat: Stat) =>
    stat.newOnly
      ? jobs.filter((j) => isNewSince(j, lastVisit)).length
      : jobs.filter((j) => stat.statuses!.includes(j.status)).length

  return (
    <Row gutter={[12, 12]}>
      {STATS.map((stat) => {
        const active = activeKey === stat.key
        return (
          <Col key={stat.key} xs={12} sm={8} lg={{ flex: 1 }}>
            <Card
              size="small"
              hoverable
              role="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? null : stat)}
              style={{
                borderColor: active ? stat.color : undefined,
                boxShadow: active ? `0 0 0 1px ${stat.color}` : undefined,
                borderTop: `3px solid ${stat.color}`,
                height: '100%',
              }}
            >
              <Statistic
                title={<span style={{ color: token.colorTextSecondary }}>{stat.title}</span>}
                value={count(stat)}
                styles={{ content: { color: stat.color, fontWeight: 600 } }}
              />
            </Card>
          </Col>
        )
      })}
    </Row>
  )
}
