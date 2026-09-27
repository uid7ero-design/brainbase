import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  maxWidth?: CSSProperties['maxWidth']
}

export function PageContainer({ children, maxWidth = 720, style, ...rest }: PageContainerProps) {
  return (
    <div {...rest} style={{ maxWidth, margin: '0 auto', ...style }}>
      {children}
    </div>
  )
}

export default PageContainer
