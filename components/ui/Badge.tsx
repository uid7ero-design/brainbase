import type { CSSProperties, HTMLAttributes } from 'react'

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const VARIANTS: Record<BadgeVariant, CSSProperties> = {
  neutral: {
    background: 'var(--bb-surface-soft)',
    color: 'var(--bb-text-tertiary)',
    borderColor: 'var(--bb-border-default)',
  },
  accent: {
    background: 'var(--bb-accent-soft)',
    color: 'var(--bb-accent-300)',
    borderColor: 'var(--bb-border-accent)',
  },
  success: {
    background: 'var(--bb-success-soft)',
    color: 'var(--bb-success)',
    borderColor: 'rgba(34, 197, 94, 0.22)',
  },
  warning: {
    background: 'var(--bb-warning-soft)',
    color: 'var(--bb-warning)',
    borderColor: 'rgba(245, 158, 11, 0.22)',
  },
  danger: {
    background: 'var(--bb-danger-soft)',
    color: 'var(--bb-danger)',
    borderColor: 'rgba(239, 68, 68, 0.22)',
  },
  info: {
    background: 'var(--bb-info-soft)',
    color: 'var(--bb-info)',
    borderColor: 'rgba(56, 189, 248, 0.22)',
  },
}

export function Badge({ variant = 'neutral', style, children, ...rest }: BadgeProps) {
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    padding: '0 var(--bb-space-4)',
    borderRadius: 'var(--bb-radius-pill)',
    borderWidth: 1,
    borderStyle: 'solid',
    fontFamily: 'var(--bb-font-sans)',
    fontSize: 'var(--bb-type-label-size)',
    lineHeight: 'var(--bb-type-label-line)',
    fontWeight: 'var(--bb-type-label-weight)',
    letterSpacing: 'var(--bb-type-label-tracking)',
    whiteSpace: 'nowrap',
  }

  return (
    <span {...rest} style={{ ...baseStyle, ...VARIANTS[variant], ...style }}>
      {children}
    </span>
  )
}

export default Badge
