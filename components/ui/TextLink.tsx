import Link from 'next/link'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

export type TextLinkTone = 'accent' | 'muted' | 'primary'

export interface TextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  tone?: TextLinkTone
  children: ReactNode
}

const COLORS: Record<TextLinkTone, string> = {
  accent: 'var(--bb-accent-400)',
  muted: 'var(--bb-text-muted)',
  primary: 'var(--bb-text-primary)',
}

const DECORATIONS: Record<TextLinkTone, 'underline' | 'none'> = {
  accent: 'underline',
  muted: 'none',
  primary: 'none',
}

export function TextLink({ href, tone = 'accent', style, children, ...rest }: TextLinkProps) {
  const sharedStyle = {
    color: COLORS[tone],
    textDecoration: DECORATIONS[tone],
    ...style,
  }

  if (href.startsWith('/')) {
    return (
      <Link href={href} {...rest} style={sharedStyle}>
        {children}
      </Link>
    )
  }

  return (
    <a href={href} {...rest} style={sharedStyle}>
      {children}
    </a>
  )
}

export default TextLink
