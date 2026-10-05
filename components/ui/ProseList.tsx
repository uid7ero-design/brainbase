import type { HTMLAttributes, ReactNode } from 'react'

export interface ProseListProps extends HTMLAttributes<HTMLUListElement> {
  items: ReactNode[]
}

export function ProseList({ items, style, ...rest }: ProseListProps) {
  return (
    <ul
      {...rest}
      style={{
        margin: '10px 0 0',
        paddingLeft: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--bb-space-3)',
        ...style,
      }}
    >
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

export default ProseList
