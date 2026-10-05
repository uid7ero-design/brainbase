import type { HTMLAttributes, ReactNode } from 'react'

export interface PageCanvasProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function PageCanvas({ children, style, ...rest }: PageCanvasProps) {
  return (
    <div
      {...rest}
      style={{
        minHeight: '100vh',
        background: 'var(--bb-canvas)',
        color: 'var(--bb-text-primary)',
        fontFamily: 'var(--bb-font-sans)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export default PageCanvas
