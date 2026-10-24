import { useContext } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button, Flex, Grid, Layout, Menu, Tag, theme, Tooltip, Typography } from 'antd'
import {
  BarChartOutlined, ControlOutlined, FilterOutlined, LogoutOutlined, MoonOutlined, ProjectOutlined, SunOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useApi } from '../data/hooks'
import { useAuth } from '../data/authContext'
import { ThemeModeContext, ThemeToggleContext } from '../lib/theme'

const PAGES = [
  { path: '/', label: 'Jobs', short: 'Jobs', icon: <UnorderedListOutlined /> },
  { path: '/board', label: 'Board', short: 'Board', icon: <ProjectOutlined /> },
  { path: '/analytics', label: 'Analytics', short: 'Analytics', icon: <BarChartOutlined /> },
  { path: '/filtered', label: 'Filtered out', short: 'Filtered', icon: <FilterOutlined /> },
  { path: '/rules', label: 'Rules', short: 'Rules', icon: <ControlOutlined /> },
]

const nav = PAGES.map((p) => ({ key: p.path, icon: p.icon, label: <Link to={p.path}>{p.label}</Link> }))

/** Height of the phone tab bar; the content and sticky bars sit above it. */
const TAB_BAR = 56

/** Phones: all five pages in a bottom tab bar, within thumb reach, instead of a header menu that overflows. */
function TabBar({ current }: { current: string }) {
  const { token } = theme.useToken()
  return (
    <nav aria-label="Pages" style={{
      position: 'fixed', insetInline: 0, bottom: 0, zIndex: 100, display: 'flex',
      height: `calc(${TAB_BAR}px + env(safe-area-inset-bottom))`, paddingBottom: 'env(safe-area-inset-bottom)',
      background: token.colorBgContainer, borderTop: `1px solid ${token.colorBorderSecondary}`,
    }}>
      {PAGES.map((p) => {
        const active = current === p.path
        return (
          <Link key={p.path} to={p.path} aria-current={active ? 'page' : undefined} className="tab-bar-link"
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              fontSize: 11, color: active ? token.colorPrimaryText : token.colorTextSecondary,
              fontWeight: active ? 600 : 400,
            }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{p.icon}</span>
            {p.short}
          </Link>
        )
      })}
    </nav>
  )
}

/** The nav item for a path: "/board/x" -> "/board". */
const navKey = (pathname: string) => `/${pathname.split('/')[1] ?? ''}`

export function AppLayout() {
  const themeMode = useContext(ThemeModeContext)
  const onToggleTheme = useContext(ThemeToggleContext)
  const api = useApi()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { token } = theme.useToken()
  const screens = Grid.useBreakpoint()

  return (
    // --tab-bar lets sticky bottom bars (the Rules save bar) sit above the phone tab bar.
    <Layout style={{ minHeight: '100vh', ['--tab-bar' as string]: screens.sm ? '0px' : `${TAB_BAR}px` }}>
      <Layout.Header
        style={{
          display: 'flex', alignItems: 'center', gap: screens.sm ? 16 : 8, paddingInline: 16,
          background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex gap={10} align="center">
          <Flex align="center" justify="center" aria-hidden
            style={{
              width: 30, height: 30, borderRadius: token.borderRadius, fontSize: 13, fontWeight: 700,
              letterSpacing: '0.02em', color: token.colorBgContainer, background: token.colorPrimary,
            }}>
            JT
          </Flex>
          <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>JobTracker</Typography.Text>
        </Flex>
        {api.demo && (
          <Tooltip title="Sample data: changes last until you reload">
            <Tag style={{
              marginInlineEnd: 0, color: token.colorText, background: token.colorWarningBg,
              borderColor: token.colorWarningBorder,
            }}>{screens.sm ? 'Demo · sample data' : 'Demo'}</Tag>
          </Tooltip>
        )}
        {screens.sm ? (
          <Menu
            mode="horizontal"
            selectedKeys={[navKey(pathname)]}
            items={nav}
            style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
          />
        ) : <div style={{ flex: 1 }} />}
        <Flex gap={4} align="center">
          <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <Button type="text" aria-label="Dark mode" aria-pressed={themeMode === 'dark'} onClick={onToggleTheme}
              icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />} />
          </Tooltip>
          {!api.demo && (
            <Tooltip title={`Sign out ${user?.email ?? ''}`}>
              <Button type="text" aria-label="Sign out" icon={<LogoutOutlined />} onClick={() => api.auth.signOut()} />
            </Tooltip>
          )}
        </Flex>
      </Layout.Header>
      <Layout.Content style={{
        padding: 16, paddingBottom: screens.sm ? 16 : TAB_BAR + 24, maxWidth: 1400, width: '100%', margin: '0 auto',
      }}>
        <Outlet />
      </Layout.Content>
      {!screens.sm && <TabBar current={navKey(pathname)} />}
    </Layout>
  )
}
