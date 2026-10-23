import { useMemo, useState } from 'react'
import { Alert, Button, Collapse, Empty, Flex, Segmented, Skeleton, Table, Tag, Tooltip, Typography } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import type { TableColumnsType } from 'antd'
import type { FilteredJob } from '../data/types'
import { jobKeyString } from '../data/types'
import { useFilteredJobs } from '../data/hooks'
import { dateTime, errorText, fromNow, sourceLabel } from '../lib/format'
import { groupByReason, reasonDetail } from '../lib/reasons'

const RANGES = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const columns: TableColumnsType<FilteredJob> = [
  {
    title: 'Job',
    key: 'job',
    render: (_, job) => (
      <Flex vertical gap={2}>
        <Typography.Link href={job.url} target="_blank" rel="noreferrer" className="clamp-2" style={{ maxWidth: 420 }}>
          {job.title} <ExportOutlined aria-label="opens the listing in a new tab" style={{ fontSize: 12 }} />
        </Typography.Link>
        <Typography.Text type="secondary" className="clamp-2" style={{ maxWidth: 420 }}>
          {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
        </Typography.Text>
      </Flex>
    ),
  },
  {
    title: 'Matched text',
    dataIndex: 'reason',
    render: (reason: string) => reasonDetail(reason) ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Arrangement',
    dataIndex: 'work_arrangements',
    responsive: ['md'],
    render: (arrangements: string[]) => arrangements.join(', ') || '—',
  },
  {
    title: 'Source',
    dataIndex: 'source',
    responsive: ['md'],
    render: (source: FilteredJob['source']) => sourceLabel(source),
  },
  {
    title: 'Seen',
    dataIndex: 'first_seen',
    render: (iso: string) => <Tooltip title={dateTime(iso)}>{fromNow(iso)}</Tooltip>,
  },
]

export function FilteredPage() {
  const [days, setDays] = useState(7)
  const filtered = useFilteredJobs(days)
  const groups = useMemo(() => groupByReason(filtered.data ?? []), [filtered.data])

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Typography.Title level={1} style={{ margin: 0 }}>Filtered out</Typography.Title>
          <Typography.Text type="secondary">
            Jobs the rules dropped, grouped by rule. A group with jobs you'd want means that rule is too strict.
          </Typography.Text>
        </div>
        <Segmented options={RANGES} value={days} onChange={(v) => setDays(v)} />
      </Flex>

      {filtered.isError ? (
        <Alert type="error" showIcon title="Couldn't load filtered jobs" description={errorText(filtered.error)}
          action={<Button size="small" onClick={() => filtered.refetch()}>Try again</Button>} />
      ) : filtered.isPending ? (
        <Skeleton active />
      ) : groups.length === 0 ? (
        <Empty description={`Nothing filtered out in the last ${days} days.`} />
      ) : (
        <Collapse
          items={groups.map((group) => ({
            key: group.reason,
            label: (
              <Flex gap={8} align="center" wrap>
                <Typography.Text strong>{capitalise(group.reason)}</Typography.Text>
                <Tag className="tabular" style={{ marginInlineEnd: 0 }}>{group.jobs.length}</Tag>
              </Flex>
            ),
            children: (
              <Table<FilteredJob> rowKey={jobKeyString} columns={columns} dataSource={group.jobs}
                size="small" pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: 'max-content' }} />
            ),
          }))}
        />
      )}
    </Flex>
  )
}
