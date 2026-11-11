import { useState } from 'react'
import { App, Button, Col, DatePicker, Form, Input, Modal, Row, Select } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { ApplicationChannel, Job, JobStatus, RoleType, WorkSetup } from '../data/types'
import { useLogApplication, useResumeVersions } from '../data/hooks'
import { CHANNEL_LABELS, ROLE_TYPE_LABELS, WORK_SETUP_LABELS, options, resumeOptions } from '../lib/application'
import { errorText } from '../lib/format'
import { STATUS_META } from '../lib/status'

interface Values {
  title: string
  company?: string
  location?: string
  url?: string
  status: JobStatus
  channel: ApplicationChannel
  resume_version: string
  role_type: RoleType
  work_setup: WorkSetup
  applied: Dayjs
  notes?: string
}

// A logged application starts at a stage you've reached; New, Skip and Expired
// don't apply, and how you applied (email or not) is the channel.
const STAGES: JobStatus[] = ['applied', 'exam', 'interview', 'offer', 'rejected', 'withdrawn']

const INITIAL: Partial<Values> = {
  status: 'applied', channel: 'referral', resume_version: 'unknown', role_type: 'unknown', work_setup: 'unknown',
}

/**
 * "Log application": for referrals, direct messages and company sites that no
 * scraper found. Saved as a 'manual' job, so it's on the board and in the analytics.
 */
export function LogApplicationButton({ onLogged }: { onLogged?: (job: Job) => void }) {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<Values>()
  const log = useLogApplication()
  const resumes = useResumeVersions()

  const submit = (values: Values) => {
    const blank = (s?: string) => s?.trim() || null
    log.mutate({
      title: values.title.trim(),
      company: blank(values.company),
      location: blank(values.location),
      url: values.url?.trim() ?? '',
      status: values.status,
      notes: blank(values.notes),
      channel: values.channel,
      resume_version: values.resume_version,
      role_type: values.role_type,
      work_setup: values.work_setup,
      // Midday, so the day doesn't shift in another time zone.
      applied_at: values.applied.hour(12).minute(0).second(0).millisecond(0).toISOString(),
    }, {
      onSuccess: (job) => {
        message.success('Application logged')
        setOpen(false)
        form.resetFields()
        onLogged?.(job)
      },
      onError: (e) => message.error(`Couldn't log it: ${errorText(e)}`),
    })
  }

  return (
    <>
      <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>Log application</Button>
      <Modal
        open={open}
        title="Log an application"
        okText="Log application"
        onOk={() => form.submit()}
        confirmLoading={log.isPending}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        width={560}
      >
        <Form<Values> form={form} layout="vertical" onFinish={submit} requiredMark={false}
          initialValues={{ ...INITIAL, applied: dayjs() }}>
          <Form.Item name="title" label="Role" rules={[{ required: true, whitespace: true, message: 'Name the role' }]}>
            <Input placeholder="e.g. Frontend Developer" autoFocus />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="company" label="Company"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="location" label="Location"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="url" label="Link" rules={[{ type: 'url', message: 'Use a full link (https://…)' }]}>
            <Input placeholder="The posting or your message thread" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={12} sm={8}>
              <Form.Item name="channel" label="Channel"><Select options={options(CHANNEL_LABELS)} /></Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="resume_version" label="Resume">
                <Select loading={resumes.isPending} options={resumeOptions(resumes.data ?? [{ key: 'unknown', label: 'Unknown' }])} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="role_type" label="Role type"><Select options={options(ROLE_TYPE_LABELS)} /></Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="work_setup" label="Work setup"><Select options={options(WORK_SETUP_LABELS)} /></Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="status" label="Stage">
                <Select options={STAGES.map((s) => ({ value: s, label: STATUS_META[s].label }))} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="applied" label="Applied on" rules={[{ required: true, message: 'Pick a day' }]}>
                <DatePicker style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="Notes" style={{ marginBottom: 0 }}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="Who referred you, follow-ups" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
