import type { HTMLAttributes, ReactNode } from 'react'

export interface ProseSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  children: ReactNode
}

export function ProseSection({ title, children, style, ...rest }: ProseSectionProps) {
  return (
    <section {...rest} style={{ marginBottom: 'var(--bb-space-9)', ...style }}>
      <h2
        style={{
          fontSize: 'var(--bb-type-card-title-size)',
          lineHeight: 'var(--bb-type-card-title-line)',
          fontWeight: 'var(--bb-type-card-title-weight)',
          color: 'var(--bb-text-primary)',
          margin: '0 0 var(--bb-space-4)',
          letterSpacing: 'var(--bb-type-card-title-tracking)',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: 'var(--bb-type-body-size)',
          color: 'var(--bb-text-secondary)',
          lineHeight: 1.75,
        }}
      >
        {children}
      </div>
    </section>
  )
}

export default ProseSection
