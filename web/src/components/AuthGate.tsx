import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Flex, Form, Input, Result, Spin, Typography } from 'antd'
import { useAuth } from '../data/auth'
import { useApi } from '../data/hooks'

/** Shows the login form until you're signed in as a user listed in app_users. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const api = useApi()
  const allowed = useQuery({
    queryKey: ['isAppUser', user?.id],
    queryFn: () => api.auth.isAppUser(),
    enabled: !!user,
  })

  if (user === undefined || (user && allowed.isPending)) return <FullPage><Spin size="large" /></FullPage>
  if (!user) return <FullPage><LoginForm /></FullPage>
  if (allowed.isError) {
    return (
      <FullPage>
        <Result status="error" title="Couldn't check your access" subTitle={String(allowed.error)}
          extra={<Button onClick={() => allowed.refetch()}>Try again</Button>} />
      </FullPage>
    )
  }
  if (!allowed.data) return <FullPage><NotAllowed userId={user.id} email={user.email} /></FullPage>
  return children
}

function FullPage({ children }: { children: ReactNode }) {
  return <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>{children}</Flex>
}

function LoginForm() {
  const api = useApi()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onFinish = async ({ email, password }: { email: string; password: string }) => {
    setLoading(true)
    setError(null)
    try {
      await api.auth.signIn(email, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="JobTracker" style={{ width: '100%', maxWidth: 380 }}>
      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input autoComplete="email" autoFocus />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
        <Button type="primary" htmlType="submit" block loading={loading}>Sign in</Button>
      </Form>
    </Card>
  )
}

function NotAllowed({ userId, email }: { userId: string; email: string | null }) {
  const api = useApi()
  const sql = `insert into public.app_users (user_id) values ('${userId}');`
  return (
    <Result
      status="403"
      title="This account can't see any data yet"
      subTitle={
        <>
          Signed in as {email ?? userId}. Add the account to <code>app_users</code> once, in the
          Supabase SQL Editor, then reload:
          <Typography.Paragraph copyable={{ text: sql }} code style={{ marginTop: 12 }}>{sql}</Typography.Paragraph>
        </>
      }
      extra={<Button onClick={() => api.auth.signOut()}>Sign out</Button>}
    />
  )
}
