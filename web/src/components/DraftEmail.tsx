import { useState } from 'react'
import { App, Button, Flex, Form, Input, Modal, Tooltip, Typography } from 'antd'
import { EditOutlined, MailOutlined } from '@ant-design/icons'
import type { Job, JobPatch } from '../data/types'
import { useUpdateJob } from '../data/hooks'
import {
  DEFAULT_TEMPLATE, fillTemplate, gmailComposeUrl, loadTemplate, PLACEHOLDERS, saveTemplate, type EmailTemplate,
} from '../lib/emailTemplate'
import { errorText, fromNow } from '../lib/format'

/**
 * Opens Gmail with the application email filled in, then records the draft
 * (and moves a New or Applied job to Emailed). Gmail compose links can't
 * attach files, so the resume has to be attached by hand.
 */
export function DraftEmailButton({ job }: { job: Job }) {
  const { message } = App.useApp()
  const update = useUpdateJob()
  const [editing, setEditing] = useState(false)

  const draft = () => {
    const template = loadTemplate()
    window.open(gmailComposeUrl({
      to: job.emails,
      subject: fillTemplate(template.subject, job),
      body: fillTemplate(template.body, job),
      account: template.gmailAccount,
    }), '_blank', 'noopener')

    const patch: JobPatch = { email_drafted_at: new Date().toISOString() }
    if (job.status === 'new' || job.status === 'applied') patch.status = 'emailed'
    update.mutate({ key: job, patch }, {
      onSuccess: () => message.success(patch.status ? 'Marked as emailed. Remember to attach your resume.' : 'Draft recorded'),
      onError: (e) => message.error(`Couldn't save: ${errorText(e)}`),
    })
  }

  return (
    <Flex vertical gap={4} align="start">
      <Flex gap={4} align="center" wrap>
        <Tooltip title={job.emails.length ? undefined : 'No email found in the listing; add the recipient in Gmail'}>
          <Button icon={<MailOutlined />} onClick={draft}>Draft in Gmail</Button>
        </Tooltip>
        <Button type="link" icon={<EditOutlined />} onClick={() => setEditing(true)}>Edit template</Button>
      </Flex>
      {job.email_drafted_at && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Last drafted {fromNow(job.email_drafted_at)}
        </Typography.Text>
      )}
      <TemplateModal open={editing} onClose={() => setEditing(false)} />
    </Flex>
  )
}

function TemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm<EmailTemplate>()

  const save = (values: EmailTemplate) => {
    if (saveTemplate(values)) {
      message.success('Template saved in this browser')
      onClose()
    } else {
      message.error("Couldn't save: this browser blocks local storage")
    }
  }

  return (
    <Modal
      open={open}
      title="Email template"
      okText="Save"
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
      width={640}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Flex justify="space-between">
          <Button onClick={() => form.setFieldsValue(DEFAULT_TEMPLATE)}>Reset to default</Button>
          <Flex gap={8}><CancelBtn /><OkBtn /></Flex>
        </Flex>
      )}
    >
      <Typography.Paragraph type="secondary">
        Placeholders: {PLACEHOLDERS.map((p) => <Typography.Text key={p} code>{p}</Typography.Text>)}.
        Saved in this browser only, so set it up once per device.
      </Typography.Paragraph>
      {/* The modal is rebuilt on every open, so this always shows the saved template. */}
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false} initialValues={loadTemplate()}>
        <Form.Item name="subject" label="Subject" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="body" label="Body" rules={[{ required: true }]}>
          <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} />
        </Form.Item>
        <Form.Item name="gmailAccount" label="Gmail account (optional)"
          extra="Which signed-in Google account to draft from. Leave blank for your default account.">
          <Input type="email" placeholder="you@gmail.com" autoComplete="email" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
