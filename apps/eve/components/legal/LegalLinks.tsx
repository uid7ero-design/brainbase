import Link from 'next/link';
import { LEGAL_LINKS } from '@/config/legal';
import { product } from '@/config/product';

// The legal and support links shown in every public footer.
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {LEGAL_LINKS.map(l => (
          <li key={l.href}><Link href={l.href} className="underline hover:text-eve-accent">{l.label}</Link></li>
        ))}
        <li><a href={`mailto:${product.supportEmail}`} className="underline hover:text-eve-accent">Support</a></li>
      </ul>
    </nav>
  );
}
