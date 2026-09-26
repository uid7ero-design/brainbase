import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  style,
  ...rest
}: SectionHeaderProps) {
  const rootStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--bb-space-6)',
    ...style,
  }

  return (
    <div {...rest} style={rootStyle}>
      <div style={{ minWidth: 0 }}>
        {eyebrow ? (
          <div
            style={{
              marginBottom: 'var(--bb-space-3)',
              color: 'var(--bb-text-muted)',
              fontFamily: 'var(--bb-font-sans)',
              fontSize: 'var(--bb-type-micro-size)',
              lineHeight: 'var(--bb-type-micro-line)',
              fontWeight: 'var(--bb-type-micro-weight)',
              letterSpacing: 'var(--bb-type-micro-tracking)',
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div
          style={{
            color: 'var(--bb-text-primary)',
            fontFamily: 'var(--bb-font-sans)',
            fontSize: 'var(--bb-type-section-title-size)',
            lineHeight: 'var(--bb-type-section-title-line)',
            fontWeight: 'var(--bb-type-section-title-weight)',
            letterSpacing: 'var(--bb-type-section-title-tracking)',
          }}
        >
          {title}
        </div>
        {description ? (
          <div
            style={{
              marginTop: 'var(--bb-space-3)',
              color: 'var(--bb-text-secondary)',
              fontFamily: 'var(--bb-font-sans)',
              fontSize: 'var(--bb-type-body-size)',
              lineHeight: 'var(--bb-type-body-line)',
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div style={{ flexShrink: 0 }}>{actions}</div> : null}
    </div>
  )
}

export default SectionHeader
