import Link from 'next/link';

// The product wordmark: the name set in the display face with a small
// accent mark. Kept as text (no image) so it inherits colour and scales
// with type; the mark is decorative and hidden from assistive tech.
export function EveWordmark({ href = '/', size = 'md' }: { href?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-xl';
  const inner = (
    <span className={`eve-display inline-flex items-baseline gap-1 ${cls}`}>
      <span>Eve</span>
      <span aria-hidden="true" className="inline-block h-[0.42em] w-[0.42em] translate-y-[0.02em] rounded-full bg-eve-accent" />
    </span>
  );
  if (!href) return <span className="text-eve-ink">{inner}</span>;
  return (
    <Link href={href} aria-label="Eve home" className="text-eve-ink no-underline">
      {inner}
    </Link>
  );
}
