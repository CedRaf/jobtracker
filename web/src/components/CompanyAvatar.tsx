import { Avatar, theme } from 'antd'

/** The company's first letter: a quiet marker to scan by, not a colour code. */
export function CompanyAvatar({ company, size = 36 }: { company: string | null; size?: number }) {
  const { token } = theme.useToken()
  const name = company?.trim() || '?'
  return (
    <Avatar shape="square" size={size} aria-hidden
      style={{ background: token.colorFillSecondary, color: token.colorTextSecondary, flexShrink: 0, fontWeight: 600 }}>
      {name.charAt(0).toUpperCase()}
    </Avatar>
  )
}
