import { useState, type ReactNode } from 'react'
import { Card, Empty, Flex, Segmented, Table, Tooltip, Typography, type TableColumnsType } from 'antd'
import { useResumeVersions } from '../data/hooks'
import {
  MIN_SAMPLE, breakdown, dropOff, type Application, type Dimension, type DropOffStage, type GroupStats,
} from '../lib/analytics'
import { CHANNEL_LABELS, ROLE_TYPE_LABELS, WORK_SETUP_LABELS } from '../lib/application'
import { useChartColors } from '../lib/chartColors'
import { ToneTag } from './Tags'

const DIMENSIONS: { label: string; value: Dimension }[] = [
  { label: 'Channel', value: 'channel' },
  { label: 'Resume', value: 'resume_version' },
  { label: 'Role type', value: 'role_type' },
  { label: 'Work setup', value: 'work_setup' },
]

const pct = (value: number) => `${Math.round(value * 100)}%`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A rate as a thin bar plus its value: one hue (magnitude), the number in text ink. */
function Meter({ value, count, of, muted }: { value: number; count: number; of: number; muted: boolean }) {
  const c = useChartColors()
  return (
    <Tooltip title={`${count} of ${plural(of, 'application')}`}>
      <Flex align="center" gap={8} style={{ minWidth: 120 }}>
        <div aria-hidden style={{ flex: 1, height: 6, borderRadius: 3, background: c.token.colorFillSecondary }}>
          <div style={{
            width: `${value * 100}%`, height: '100%', borderRadius: 3,
            background: muted ? c.token.colorTextQuaternary : c.single,
          }} />
        </div>
        <span className="tabular" style={{ width: 64, textAlign: 'right' }}>
          {pct(value)} <Typography.Text type="secondary" style={{ fontSize: 12 }}>({count})</Typography.Text>
        </span>
      </Flex>
    </Tooltip>
  )
}

/** Response and interview rates per channel, resume, role type or work setup. */
export function ResponseBreakdownCard({ apps }: { apps: Application[] }) {
  const [dimension, setDimension] = useState<Dimension>('channel')
  const resumes = useResumeVersions()
  const { rows, total } = breakdown(apps, dimension)

  const label = (key: string) => {
    if (key === 'all') return 'All applications'
    if (dimension === 'channel') return CHANNEL_LABELS[key as keyof typeof CHANNEL_LABELS] ?? key
    if (dimension === 'role_type') return ROLE_TYPE_LABELS[key as keyof typeof ROLE_TYPE_LABELS] ?? key
    if (dimension === 'work_setup') return WORK_SETUP_LABELS[key as keyof typeof WORK_SETUP_LABELS] ?? key
    return resumes.data?.find((v) => v.key === key)?.label ?? key
  }

  const columns: TableColumnsType<GroupStats> = [
    {
      title: DIMENSIONS.find((d) => d.value === dimension)!.label,
      key: 'group',
      render: (_, row) => (
        <Flex gap={8} align="center" wrap>
          <span style={{ fontWeight: row.key === 'all' ? 600 : undefined }}>{label(row.key)}</span>
          {row.lowSample && row.key !== 'all' && <ToneTag color="default">Not enough data</ToneTag>}
        </Flex>
      ),
    },
    { title: 'Applications', dataIndex: 'applications', align: 'right', className: 'tabular' },
    {
      title: 'Response rate',
      key: 'response',
      render: (_, row) => <Meter value={row.responseRate} count={row.responses} of={row.applications} muted={row.lowSample} />,
    },
    {
      title: 'Interview rate',
      key: 'interview',
      render: (_, row) => <Meter value={row.interviewRate} count={row.interviews} of={row.applications} muted={row.lowSample} />,
    },
    {
      title: 'Median days to reply',
      key: 'days',
      align: 'right',
      render: (_, row) => row.medianDays === null ? '—' : (
        <Tooltip title={`Based on ${plural(row.timedResponses, 'response')} with both dates`}>
          <span className="tabular">{(Math.round(row.medianDays * 10) / 10).toString()}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}> (n={row.timedResponses})</Typography.Text>
        </Tooltip>
      ),
    },
  ]

  return (
    <Card
      size="small"
      title={(
        <div>
          <div>What gets responses</div>
          <div className="chart-subtitle">
            Applications in this period · a response is anything but no reply · fewer than {MIN_SAMPLE} is not enough data
          </div>
        </div>
      )}
      extra={<Segmented size="small" options={DIMENSIONS} value={dimension} onChange={setDimension} aria-label="Break down by" />}
    >
      {apps.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No applications in this period" />
      ) : (
        <Table<GroupStats> rowKey="key" size="small" pagination={false} scroll={{ x: 640 }}
          columns={columns} dataSource={rows}
          summary={() => (
            <Table.Summary.Row>
              {columns.map((col, i) => (
                <Table.Summary.Cell key={i} index={i} align={col.align}>
                  {'render' in col && col.render
                    ? col.render(undefined, total, -1) as ReactNode
                    : total.applications}
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          )} />
      )}
    </Card>
  )
}

const STAGE_LABELS: Record<DropOffStage['stage'], string> = { exam: 'Exam', interview: 'Interview' }

/** Of the applications that reached an exam or interview, how many went further. */
export function DropOffCard({ apps }: { apps: Application[] }) {
  const stages = dropOff(apps)
  const columns: TableColumnsType<DropOffStage> = [
    {
      title: 'Reached',
      key: 'stage',
      render: (_, s) => (
        <Flex gap={8} align="center" wrap>
          {STAGE_LABELS[s.stage]}
          {s.reached > 0 && s.reached < MIN_SAMPLE && <ToneTag color="default">Not enough data</ToneTag>}
        </Flex>
      ),
    },
    { title: 'Applications', dataIndex: 'reached', align: 'right', className: 'tabular' },
    {
      title: 'Went further',
      key: 'progressed',
      render: (_, s) => s.reached === 0 ? '—'
        : <Meter value={s.progressed / s.reached} count={s.progressed} of={s.reached} muted={s.reached < MIN_SAMPLE} />,
    },
    { title: 'Rejected', dataIndex: 'rejected', align: 'right', className: 'tabular' },
    { title: 'Still waiting', dataIndex: 'waiting', align: 'right', className: 'tabular' },
    { title: 'Ended otherwise', dataIndex: 'other', align: 'right', className: 'tabular' },
  ]
  return (
    <Card size="small" title={(
      <div>
        <div>After an exam or interview</div>
        <div className="chart-subtitle">Of the applications that got that far, how many went further</div>
      </div>
    )}>
      {stages.every((s) => s.reached === 0) ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No exams or interviews in this period yet" />
      ) : (
        <Table<DropOffStage> rowKey="stage" size="small" pagination={false} scroll={{ x: 640 }}
          columns={columns} dataSource={stages} />
      )}
    </Card>
  )
}
