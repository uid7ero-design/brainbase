// "Events made easy" with the "Eve" inside "Events" set in the accent
// colour. Assistive technology reads the plain phrase once (visually
// hidden); the split, coloured rendering is presentational.
export function Tagline({ as: Tag = 'p', className = '' }: { as?: 'p' | 'h1' | 'h2' | 'span'; className?: string }) {
  return (
    <Tag className={className}>
      <span className="sr-only">Events made easy</span>
      <span aria-hidden="true">
        <span className="text-eve-accent">Eve</span>nts made easy
      </span>
    </Tag>
  );
}
