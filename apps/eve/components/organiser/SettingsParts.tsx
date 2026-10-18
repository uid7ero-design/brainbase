import type { ReactNode } from 'react';
import type { FeePolicyView } from '@/lib/ticketing/gateway';
import { formatAmount } from '@/lib/format';

// Presentation helpers for the READ-ONLY Settings page. No control here
// changes anything; chips only state what is stored.

type Tone = 'good' | 'neutral' | 'warn';
const TONE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  neutral: 'bg-stone-100 text-stone-800 border-stone-300',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
};

export function Chip({ tone = 'neutral', children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return <span data-testid={testId} className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

export function Section({ title, chip, children, id }: { title: string; chip?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={`h-${id}`} data-testid={`section-${id}`} className="rounded-lg border border-eve-line bg-eve-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`h-${id}`} className="text-base font-semibold">{title}</h2>
        {chip}
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-eve-muted">{k}</dt><dd className="font-medium">{v}</dd></div>))}
    </dl>
  );
}

export function percent(bps: number): string {
  const p = bps / 100;
  return `${Number.isInteger(p) ? p.toFixed(0) : p.toFixed(2).replace(/0+$/, '')}%`;
}

// Human description of a fee policy's components, e.g. "2.5% + $0.30 per order".
export function describeFee(f: Extract<FeePolicyView, { state: 'FEE' }>): string {
  const parts: string[] = [];
  if (f.percent_bps > 0) parts.push(percent(f.percent_bps));
  if (f.fixed_per_order_cents > 0) parts.push(`${formatAmount(f.fixed_per_order_cents, f.currency)} per order`);
  if (f.fixed_per_ticket_cents > 0) parts.push(`${formatAmount(f.fixed_per_ticket_cents, f.currency)} per ticket`);
  let text = parts.length ? parts.join(' + ') : 'No amount';
  if (f.min_fee_cents !== null) text += ` · minimum ${formatAmount(f.min_fee_cents, f.currency)}`;
  if (f.max_fee_cents !== null) text += ` · maximum ${formatAmount(f.max_fee_cents, f.currency)}`;
  return text;
}
