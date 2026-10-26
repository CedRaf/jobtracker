import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Collapse, Empty, Flex, Grid, Segmented, Skeleton, Table, Tag, Tooltip, Typography } from 'antd'
import { EditOutlined, ExportOutlined } from '@ant-design/icons'
import type { TableColumnsType } from 'antd'
import type { FilteredJob } from '../data/types'
import { jobKeyString } from '../data/types'
import { useFilteredJobs, useSettingsVersions, useSourceLabel } from '../data/hooks'
import { dateTime, errorText, fromNow } from '../lib/format'
import { groupByReason, reasonDetail } from '../lib/reasons'
import { ruleLocation, rulesHref } from '../lib/ruleLinks'

const RANGES = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]
const DAYS = RANGES.map((r) => r.value)

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const matched = (reason: string) => reasonDetail(reason) ?? <Typography.Text type="secondary">—</Typography.Text>

const JobCell = ({ job }: { job: FilteredJob }) => (
      <Flex vertical gap={2}>
        <Typography.Link href={job.url} target="_blank" rel="noreferrer" className="clamp-2" style={{ maxWidth: 420 }}>
          {job.title} <ExportOutlined aria-label="opens the listing in a new tab" style={{ fontSize: 12 }} />
        </Typography.Link>
        <Typography.Text type="secondary" className="clamp-2" style={{ maxWidth: 420 }}>
          {job.company ?? 'Unknown company'} · {job.location ?? 'No location'}
        </Typography.Text>
      </Flex>
)

type Site = ReturnType<typeof useSourceLabel>

/** The Source column only when there are several sites. */
const columns = (site: Site): TableColumnsType<FilteredJob> => [
  { title: 'Job', key: 'job', render: (_, job) => <JobCell job={job} /> },
  { title: 'Matched text', dataIndex: 'reason', render: matched },
  {
    title: 'Arrangement',
    dataIndex: 'work_arrangements',
    responsive: ['md'],
    render: (arrangements: string[]) => arrangements.join(', ') || '—',
  },
  ...(site.multi ? [{
    title: 'Source',
    dataIndex: 'source',
    responsive: ['md' as const],
    render: (source: FilteredJob['source']) => site.label(source),
  }] : []),
  {
    title: 'Seen',
    dataIndex: 'first_seen',
    render: (iso: string) => <Tooltip title={dateTime(iso)}><span style={{ whiteSpace: 'nowrap' }}>{fromNow(iso)}</span></Tooltip>,
  },
]

// Phones: one stacked column, so nothing scrolls sideways inside the accordion.
const phoneColumns = (site: Site): TableColumnsType<FilteredJob> => [
  {
    title: 'Job',
    key: 'job',
    render: (_, job) => (
      <Flex vertical gap={4}>
        <JobCell job={job} />
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {reasonDetail(job.reason) && <>Matched “{reasonDetail(job.reason)}” · </>}
          {site.multi && `${site.label(job.source)} · `}{fromNow(job.first_seen)}
        </Typography.Text>
      </Flex>
    ),
  },
]

export function FilteredPage() {
  // Period and open rule live in the URL (?days=&rule=), so Analytics and Rules can link here.
  const [params, setParams] = useSearchParams()
  const days = DAYS.includes(Number(params.get('days'))) ? Number(params.get('days')) : 7
  const linkedRule = params.get('rule')
  const setDays = (next: number) => setParams({ days: String(next) }, { replace: true })
  const filtered = useFilteredJobs(days)
  const settings = useSettingsVersions()
  const screens = Grid.useBreakpoint()
  const site = useSourceLabel()
  const groups = useMemo(() => groupByReason(filtered.data ?? []), [filtered.data])
  // The linked rule's group, else the biggest: the one most worth a look.
  const openKey = groups.some((g) => g.reason === linkedRule) ? linkedRule! : groups[0]?.reason

  useEffect(() => {
    if (linkedRule) document.getElementById(`rule-${linkedRule}`)?.scrollIntoView({ block: 'start' })
  }, [linkedRule, groups])

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Typography.Title level={1} style={{ margin: 0 }}>Filtered out</Typography.Title>
          <Typography.Text type="secondary">
            Jobs the rules dropped, grouped by rule. A group with jobs you'd want means that rule is too strict.
          </Typography.Text>
        </div>
        <Segmented options={RANGES} value={days} onChange={(v) => setDays(v)} aria-label="Period" />
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
          // Keyed so a new period or linked rule opens its group again.
          key={`${days}:${openKey}`}
          defaultActiveKey={openKey ? [openKey] : []}
          items={groups.map((group) => {
            const location = ruleLocation(group.reason, settings.data?.[0]?.settings)
            return {
              key: group.reason,
              label: (
                <Flex gap={8} align="center" wrap id={`rule-${group.reason}`}>
                  <Typography.Text strong>{capitalise(group.reason)}</Typography.Text>
                  <Tag className="tabular" style={{ marginInlineEnd: 0 }}>{group.jobs.length}</Tag>
                </Flex>
              ),
              extra: location && (
                // Stop the click toggling the panel.
                <Link to={rulesHref(location)} onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                  <EditOutlined /> {screens.sm ? 'Edit rule' : 'Edit'}
                </Link>
              ),
              children: (
                <Table<FilteredJob> rowKey={jobKeyString} columns={screens.md ? columns(site) : phoneColumns(site)}
                  showHeader={screens.md} dataSource={group.jobs} size="small"
                  pagination={{ pageSize: 20, hideOnSinglePage: true }} />
              ),
            }
          })}
        />
      )}
    </Flex>
  )
}
