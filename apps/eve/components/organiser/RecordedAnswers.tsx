import type { DataCategory, RecordedAnswer } from '@/lib/ticketing/gateway';

// Registration answers as recorded (label and wording snapshotted when
// answered). The API only sends `answers` to manager+ organisers; for
// anyone else this renders nothing. SENSITIVE / THIRD_PARTY / CONSENT
// answers carry a label so staff handle them with care, and an answer the
// retention policy has removed says so (its value is gone).

const CATEGORY_LABEL: Partial<Record<DataCategory, string>> = {
  SENSITIVE: 'Sensitive',
  THIRD_PARTY: 'Another person’s details',
  CONSENT: 'Consent',
};

function display(a: RecordedAnswer): string {
  if (a.redacted_at || a.answer === null) return 'Removed under the retention policy';
  if (typeof a.answer === 'boolean') return a.answer ? 'Yes' : 'No';
  if (Array.isArray(a.answer)) return a.answer.join(', ');
  return String(a.answer);
}

export function RecordedAnswers({ answers }: { answers?: RecordedAnswer[] }) {
  if (!answers || answers.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1 text-xs font-normal" data-testid="recorded-answers">
      {answers.map((a, i) => (
        <div key={i}>
          <dt className="text-eve-muted">
            {a.label}
            {CATEGORY_LABEL[a.data_category] ? <span className="ml-1 rounded bg-eve-surface-alt px-1 font-semibold text-eve-ink">{CATEGORY_LABEL[a.data_category]}</span> : null}
          </dt>
          <dd className={`whitespace-pre-line ${a.redacted_at ? 'italic text-eve-muted' : 'text-eve-ink'}`}>{display(a)}</dd>
        </div>
      ))}
    </dl>
  );
}
