import { forwardRef } from 'react'
import type { CSSProperties, InputHTMLAttributes } from 'react'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { style, ...rest },
  ref,
) {
  const baseStyle: CSSProperties = {
    width: '100%',
    minHeight: 'var(--bb-control-height-md)',
    padding: '0 var(--bb-space-4)',
    background: 'var(--bb-surface-2)',
    border: '1px solid var(--bb-border-default)',
    borderRadius: 'var(--bb-radius-md)',
    color: 'var(--bb-text-primary)',
    fontFamily: 'var(--bb-font-sans)',
    fontSize: 'var(--bb-type-body-size)',
    lineHeight: 'var(--bb-type-body-line)',
    outline: 'none',
    transition: `border-color var(--bb-duration-fast) var(--bb-ease-standard), box-shadow var(--bb-duration-fast) var(--bb-ease-standard)`,
  }

  return <input ref={ref} {...rest} style={{ ...baseStyle, ...style }} />
})

export default Input
