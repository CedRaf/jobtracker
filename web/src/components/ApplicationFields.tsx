import { useState, type ReactNode } from 'react'
import { App, Button, DatePicker, Divider, Flex, Input, Select, Space, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { ApplicationChannel, Job, JobPatch, RoleType, WorkSetup } from '../data/types'
import { useAddResumeVersion, useResumeVersions, useStatusHistory, useUpdateJob } from '../data/hooks'
import {
  CHANNEL_LABELS, ROLE_TYPE_LABELS, WORK_SETUP_LABELS, options, resumeKey, resumeOptions,
} from '../lib/application'
import { daysToResponse, deriveOutcome, OUTCOME_LABELS } from '../lib/analytics'
import { APPLIED_STAGES, liveHistory, RESPONSE_STAGES } from '../lib/transitions'
import { errorText } from '../lib/format'

const SELECT_WIDTH = 168

/** A labelled field: the label sits above, like the drawer's other sections. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <Flex vertical gap={4}>
      <Typography.Text type="secondary"><label htmlFor={id}>{label}</label></Typography.Text>
      {children}
    </Flex>
  )
}

/**
 * How you applied, for the "what gets responses" analytics. Every change saves
 * at once (with the board's optimistic update), so there's no Save button.
 */
export function ApplicationFields({ job }: { job: Job }) {
  const { message } = App.useApp()
  const update = useUpdateJob()
  const resumes = useResumeVersions()
  const id = (field: string) => `${field}-${job.source}-${job.external_id}`

  const save = (patch: JobPatch) =>
    update.mutate({ key: job, patch }, { onError: (e) => message.error(`Couldn't save: ${errorText(e)}`) })

  // Dates are picked by day; a changed day keeps the time of day already stored.
  const withDay = (day: Dayjs | null, current: string | null) => {
    if (!day) return null
    const base = current ? dayjs(current) : day.startOf('day')
    return base.year(day.year()).month(day.month()).date(day.date()).toISOString()
  }
  const setApplied = (day: Dayjs | null) => {
    const applied_at = withDay(day, job.applied_at)
    // The database refuses a response before the application: move it along.
    const tooEarly = applied_at && job.first_response_at && Date.parse(job.first_response_at) < Date.parse(applied_at)
    save(tooEarly ? { applied_at, first_response_at: applied_at } : { applied_at })
  }
  const setResponse = (day: Dayjs | null) => {
    const at = withDay(day, job.first_response_at)
    save({ first_response_at: at && job.applied_at && Date.parse(at) < Date.parse(job.applied_at) ? job.applied_at : at })
  }

  const history = useStatusHistory()
  const days = daysToResponse(job)
  // Like the analytics: the furthest stage it ever reached, not just the current one.
  const outcome = deriveOutcome(new Set([job.status, ...liveHistory(history.data ?? [])
    .filter((h) => h.job_source === job.source && h.job_external_id === job.external_id)
    .map((h) => h.to_status)]))

  return (
    <Flex vertical gap={8}>
      <Divider titlePlacement="start" style={{ margin: 0 }}>Application</Divider>
      <Flex gap={12} wrap>
        <Field id={id('channel')} label="Channel">
          <Select<ApplicationChannel> id={id('channel')} value={job.channel} style={{ width: SELECT_WIDTH }}
            options={options(CHANNEL_LABELS)} onChange={(channel) => save({ channel })} />
        </Field>
        <Field id={id('resume')} label="Resume">
          <Select<string> id={id('resume')} value={job.resume_version} style={{ width: SELECT_WIDTH }}
            loading={resumes.isPending}
            // Before the list loads, still show the saved key.
            options={resumes.data ? resumeOptions(resumes.data) : [{ value: job.resume_version, label: job.resume_version }]}
            onChange={(resume_version) => save({ resume_version })}
            popupRender={(menu) => <>{menu}<AddResumeVersion onAdded={(key) => save({ resume_version: key })} /></>} />
        </Field>
        <Field id={id('role')} label="Role type">
          <Select<RoleType> id={id('role')} value={job.role_type} style={{ width: SELECT_WIDTH }}
            options={options(ROLE_TYPE_LABELS)} onChange={(role_type) => save({ role_type })} />
        </Field>
        <Field id={id('setup')} label="Work setup">
          <Select<WorkSetup> id={id('setup')} value={job.work_setup} style={{ width: SELECT_WIDTH }}
            options={options(WORK_SETUP_LABELS)} onChange={(work_setup) => save({ work_setup })} />
        </Field>
        <Field id={id('applied')} label="Applied on">
          {/* The status needs these dates once set: they can be changed, not cleared. */}
          <DatePicker id={id('applied')} value={job.applied_at ? dayjs(job.applied_at) : null}
            allowClear={!(job.applied_at && APPLIED_STAGES.includes(job.status))}
            style={{ width: SELECT_WIDTH }} onChange={setApplied}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Field>
        <Field id={id('response')} label="First response">
          <DatePicker id={id('response')} value={job.first_response_at ? dayjs(job.first_response_at) : null}
            allowClear={!(job.first_response_at && RESPONSE_STAGES.includes(job.status))}
            style={{ width: SELECT_WIDTH }} onChange={setResponse} placeholder="No reply yet"
            disabledDate={(d) => d.isAfter(dayjs(), 'day') || (!!job.applied_at && d.isBefore(dayjs(job.applied_at), 'day'))} />
        </Field>
      </Flex>
      <Typography.Text type="secondary">
        Outcome: {OUTCOME_LABELS[outcome]}
        {days !== null && ` · first response after ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`}
        {' '}(follows the status)
      </Typography.Text>
    </Flex>
  )
}

/** "Add a version" at the bottom of the resume dropdown. */
function AddResumeVersion({ onAdded }: { onAdded: (key: string) => void }) {
  const { message } = App.useApp()
  const add = useAddResumeVersion()
  const resumes = useResumeVersions()
  const [label, setLabel] = useState('')
  const key = resumeKey(label)
  const taken = !!key && !!resumes.data?.some((v) => v.key === key)

  const submit = () => {
    if (!key || taken) return
    add.mutate(label, {
      onSuccess: (added) => {
        setLabel('')
        onAdded(added.key)
      },
      onError: (e) => message.error(`Couldn't add it: ${errorText(e)}`),
    })
  }

  return (
    <>
      <Divider style={{ margin: '8px 0' }} />
      <Space.Compact style={{ padding: '0 8px 4px', width: '100%' }}>
        <Input placeholder="New version, e.g. Data" aria-label="New resume version" value={label}
          status={taken ? 'warning' : undefined}
          onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onPressEnter={submit} />
        <Button icon={<PlusOutlined />} disabled={!key || taken} loading={add.isPending} onClick={submit}>Add</Button>
      </Space.Compact>
    </>
  )
}
