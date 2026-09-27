import type { ButtonHTMLAttributes, CSSProperties } from 'react'

export type IconButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string
  size?: IconButtonSize
}

const SIZES: Record<IconButtonSize, string> = {
  sm: 'var(--bb-control-height-sm)',
  md: 'var(--bb-control-height-md)',
  lg: 'var(--bb-control-height-lg)',
}

export function IconButton({
  size = 'md',
  style,
  children,
  ...rest
}: IconButtonProps) {
  const dimension = SIZES[size]
  const baseStyle: CSSProperties = {
    width: dimension,
    height: dimension,
    minWidth: dimension,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: 'var(--bb-radius-md)',
    background: 'transparent',
    border: '1px solid var(--bb-border-default)',
    color: 'var(--bb-text-tertiary)',
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.5 : 1,
    transition: `background var(--bb-duration-fast) var(--bb-ease-standard), color var(--bb-duration-fast) var(--bb-ease-standard), border-color var(--bb-duration-fast) var(--bb-ease-standard)`,
  }

  return (
    <button {...rest} style={{ ...baseStyle, ...style }}>
      {children}
    </button>
  )
}

export default IconButton
