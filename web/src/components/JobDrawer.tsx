import { useState } from 'react'
import {
  App, Button, Descriptions, Divider, Drawer, Flex, Grid, Input, Select, Skeleton, Space, Typography,
} from 'antd'
import { ExportOutlined, FormOutlined, MailOutlined } from '@ant-design/icons'
import type { Job, JobPatch } from '../data/types'
import { jobKeyString } from '../data/types'
import { useJobDescription, useUpdateJob } from '../data/hooks'
import { dateTime, fromNow, sourceLabel } from '../lib/format'
import { SHOW_MATCH_SCORE } from '../lib/settings'
import { statusOptions } from '../lib/status'
import { CompanyAvatar } from './CompanyAvatar'
import { FlagTags, SkillTags, StatusTag } from './Tags'

export function JobDrawer({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const screens = Grid.useBreakpoint()
  return (
    <Drawer
      open={job !== null}
      onClose={onClose}
      size={screens.md ? 720 : '100%'}
      destroyOnHidden
      title={job?.title}
      extra={job && (
        <Button href={job.url} target="_blank" rel="noreferrer" icon={<ExportOutlined />}>
          Open listing
        </Button>
      )}
    >
      {/* Keyed so the edit form resets when another job is opened. */}
      {job && <JobDetails key={jobKeyString(job)} job={job} />}
    </Drawer>
  )
}

function JobDetails({ job }: { job: Job }) {
  const description = useJobDescription(job)

  return (
    <Flex vertical gap={16}>
      <Flex gap={12} align="center">
        <CompanyAvatar company={job.company} />
        <div>
          <Typography.Text strong>{job.company ?? 'Unknown company'}</Typography.Text>
          <Typography.Text type="secondary"> · {job.location ?? 'No location'}</Typography.Text>
          <Flex gap={8} align="center" style={{ marginTop: 4 }}>
            <StatusTag status={job.status} />
            {SHOW_MATCH_SCORE && <Typography.Text type="secondary">Match score {job.match_score}</Typography.Text>}
          </Flex>
        </div>
      </Flex>

      <EditForm job={job} />

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered
        items={[
          { label: 'Source', children: sourceLabel(job.source) },
          { label: 'Arrangement', children: job.work_arrangements.join(', ') || 'Not listed' },
          { label: 'Work type', children: job.work_type ?? '—' },
          { label: 'Salary', children: job.salary_text ?? 'Not shown' },
          { label: 'Posted', children: dateTime(job.posted_at) },
          { label: 'First seen', children: `${dateTime(job.first_seen)} (${fromNow(job.first_seen)})` },
          { label: 'Apply via', children: job.apply_type ?? '—' },
          ...(job.seniority ? [{ label: 'Seniority', children: job.seniority }] : []),
          { label: 'Found by', children: job.search_terms.join(', '), span: 'filled' as const },
        ]}
      />

      {(job.emails.length > 0 || job.apply_link) && (
        <Space wrap>
          {job.emails.map((email) => (
            <Button key={email} href={`mailto:${email}`} icon={<MailOutlined />}>{email}</Button>
          ))}
          {job.apply_link && (
            <Button href={job.apply_link} target="_blank" rel="noreferrer" icon={<FormOutlined />}>
              Application form
            </Button>
          )}
        </Space>
      )}

      <div>
        <Typography.Text type="secondary">Your skills it mentions</Typography.Text>
        <div style={{ marginTop: 4 }}>
          {job.matched_skills.length ? <SkillTags skills={job.matched_skills} color="blue" /> : '—'}
        </div>
      </div>
      {job.missing_skills.length > 0 && (
        <div>
          <Typography.Text type="secondary">Other stacks it mentions</Typography.Text>
          <div style={{ marginTop: 4 }}><SkillTags skills={job.missing_skills} /></div>
        </div>
      )}
      {job.flags.length > 0 && (
        <div>
          <Typography.Text type="secondary">Flags</Typography.Text>
          <div style={{ marginTop: 4 }}><FlagTags flags={job.flags} /></div>
        </div>
      )}

      <Divider titlePlacement="start" style={{ margin: 0 }}>Description</Divider>
      {description.isPending ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : description.isError ? (
        <Typography.Text type="danger">Couldn't load the description: {String(description.error)}</Typography.Text>
      ) : (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {description.data || 'No description was saved for this job.'}
        </Typography.Paragraph>
      )}
    </Flex>
  )
}

function EditForm({ job }: { job: Job }) {
  const { message } = App.useApp()
  const update = useUpdateJob()
  const [status, setStatus] = useState(job.status)
  const [skipReason, setSkipReason] = useState(job.skip_reason ?? '')
  const [notes, setNotes] = useState(job.notes ?? '')

  const patch: JobPatch = {}
  if (status !== job.status) patch.status = status
  if (skipReason !== (job.skip_reason ?? '')) patch.skip_reason = skipReason || null
  if (notes !== (job.notes ?? '')) patch.notes = notes || null
  const dirty = Object.keys(patch).length > 0

  const save = () =>
    update.mutate({ key: job, patch }, {
      onSuccess: () => message.success('Saved'),
      onError: (e) => message.error(`Couldn't save: ${e.message}`),
    })

  return (
    <Flex vertical gap={8}>
      <Flex gap={8} wrap>
        <Select value={status} options={statusOptions} onChange={setStatus} style={{ width: 160 }}
          aria-label="Status" />
        {status === 'skip' && (
          <Input placeholder="Why skip? (helps tune the rules)" value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        )}
      </Flex>
      <Input.TextArea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 8 }} />
      <Flex gap={8} justify="end">
        <Button disabled={!dirty} onClick={() => {
          setStatus(job.status)
          setSkipReason(job.skip_reason ?? '')
          setNotes(job.notes ?? '')
        }}>Discard</Button>
        <Button type="primary" disabled={!dirty} loading={update.isPending} onClick={save}>Save</Button>
      </Flex>
    </Flex>
  )
}
