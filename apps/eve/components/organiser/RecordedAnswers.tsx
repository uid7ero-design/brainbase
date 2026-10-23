import type { RecordedAnswer } from '@/lib/ticketing/gateway';

// Registration answers as recorded (label and wording snapshotted when
// answered). The API only sends `answers` to manager+ organisers; for
// anyone else this renders nothing. Answers marked sensitive are labelled
// so staff handle them with care.

function display(a: RecordedAnswer['answer']): string {
  if (typeof a === 'boolean') return a ? 'Yes' : 'No';
  if (Array.isArray(a)) return a.join(', ');
  return String(a);
}

export function RecordedAnswers({ answers }: { answers?: RecordedAnswer[] }) {
  if (!answers || answers.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1 text-xs font-normal" data-testid="recorded-answers">
      {answers.map((a, i) => (
        <div key={i}>
          <dt className="text-eve-muted">
            {a.label}
            {a.sensitive ? <span className="ml-1 rounded bg-eve-surface-alt px-1 font-semibold text-eve-ink">Sensitive</span> : null}
          </dt>
          <dd className="whitespace-pre-line text-eve-ink">{display(a.answer)}</dd>
        </div>
      ))}
    </dl>
  );
}
