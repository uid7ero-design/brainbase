import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react'

export type SurfaceVariant = 'base' | 'raised' | 'overlay' | 'soft' | 'selected'
export type SurfaceRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  variant?: SurfaceVariant
  radius?: SurfaceRadius
  border?: boolean
  children?: ReactNode
}

const BACKGROUNDS: Record<SurfaceVariant, string> = {
  base: 'var(--bb-surface-1)',
  raised: 'var(--bb-surface-2)',
  overlay: 'var(--bb-surface-3)',
  soft: 'var(--bb-surface-soft)',
  selected: 'var(--bb-surface-selected)',
}

const RADII: Record<SurfaceRadius, string> = {
  none: '0',
  sm: 'var(--bb-radius-sm)',
  md: 'var(--bb-radius-md)',
  lg: 'var(--bb-radius-lg)',
  xl: 'var(--bb-radius-xl)',
  '2xl': 'var(--bb-radius-2xl)',
}

export function Surface({
  as: Component = 'div',
  variant = 'base',
  radius = 'lg',
  border = true,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const baseStyle: CSSProperties = {
    background: BACKGROUNDS[variant],
    border: border ? `1px solid ${variant === 'selected' ? 'var(--bb-border-accent)' : 'var(--bb-border-default)'}` : 'none',
    borderRadius: RADII[radius],
  }

  return (
    <Component {...rest} style={{ ...baseStyle, ...style }}>
      {children}
    </Component>
  )
}

export default Surface
