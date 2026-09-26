import type { ButtonHTMLAttributes, CSSProperties } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: {
    minHeight: 'var(--bb-control-height-sm)',
    padding: '0 var(--bb-space-4)',
    fontSize: 'var(--bb-type-body-sm-size)',
  },
  md: {
    minHeight: 'var(--bb-control-height-md)',
    padding: '0 var(--bb-space-5)',
    fontSize: 'var(--bb-type-body-size)',
  },
  lg: {
    minHeight: 'var(--bb-control-height-lg)',
    padding: '0 var(--bb-space-6)',
    fontSize: 'var(--bb-type-body-lg-size)',
  },
}

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--bb-gradient-accent)',
    color: 'var(--bb-text-on-accent)',
    border: '1px solid transparent',
    boxShadow: '0 8px 26px rgba(106, 61, 255, 0.18)',
  },
  secondary: {
    background: 'var(--bb-surface-soft)',
    color: 'var(--bb-text-secondary)',
    border: '1px solid var(--bb-border-default)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--bb-text-tertiary)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--bb-danger-soft)',
    color: 'var(--bb-danger)',
    border: '1px solid rgba(239, 68, 68, 0.24)',
  },
}

export function Button({
  variant = 'secondary',
  size = 'md',
  style,
  children,
  ...rest
}: ButtonProps) {
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--bb-space-3)',
    borderRadius: 'var(--bb-radius-md)',
    fontFamily: 'var(--bb-font-sans)',
    fontWeight: 600,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.5 : 1,
    transition: `background var(--bb-duration-fast) var(--bb-ease-standard), color var(--bb-duration-fast) var(--bb-ease-standard), border-color var(--bb-duration-fast) var(--bb-ease-standard), opacity var(--bb-duration-fast) var(--bb-ease-standard)`,
  }

  return (
    <button
      {...rest}
      style={{ ...baseStyle, ...SIZE_STYLES[size], ...VARIANT_STYLES[variant], ...style }}
    >
      {children}
    </button>
  )
}

export default Button
