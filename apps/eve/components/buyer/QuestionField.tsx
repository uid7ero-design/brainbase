'use client';

import type { PublicQuestion } from '@/lib/ticketing/gateway';
import { organiserReference } from '@ticketing/core/publicOrganiser';

// One organiser-defined registration question on the buyer form. Display
// and UX checks only: the ticketing API re-validates every answer against
// the event's live question list (type, options, required, length) and
// refuses anything else.
//
// Yes/no is two radio buttons with neither selected, so a consent-style
// question always records what the buyer actually chose; nothing is ever
// pre-selected or pre-ticked.

export type Answer = string | boolean | string[] | undefined;

// Same limits the server enforces (lib/events/registrationQuestions.ts).
const MAX_LENGTH = { SHORT_TEXT: 300, LONG_TEXT: 4000 } as const;

export function isAnswered(a: Answer): boolean {
  if (a === undefined) return false;
  if (typeof a === 'string') return a.trim() !== '';
  if (Array.isArray(a)) return a.length > 0;
  return true;
}

const input = 'mt-1 block min-h-11 w-full rounded-lg border border-eve-line bg-white px-3 text-sm text-eve-ink';
const labelCls = 'block text-sm font-medium text-eve-ink';

// In-context privacy notes by category (ADR 0013 §4b), shown under the
// field and announced with it (aria-describedby). organiserName is the
// organiser's public display name, or null for the neutral wording.
export function categoryNote(q: PublicQuestion, organiserName: string | null): string | null {
  switch (q.data_category) {
    case 'SENSITIVE':
      return `This may include health, disability or accessibility information. ${organiserReference(organiserName, { sentenceStart: true })} asks so they can make arrangements for you at this event. Only share what you’re comfortable with.`;
    case 'THIRD_PARTY':
      return `Please make sure this person knows you’re giving their details to ${organiserReference(organiserName)} for this event.`;
    case 'CONSENT':
      return q.field_type === 'YES_NO' ? 'Choosing No won’t affect your booking.' : null;
    default:
      return null;
  }
}

export function QuestionField({ question: q, idPrefix, value, onChange, organiserName }: {
  question: PublicQuestion; idPrefix: string; value: Answer; onChange: (next: Answer) => void; organiserName: string | null;
}) {
  const id = `${idPrefix}-${q.id}`;
  const note = categoryNote(q, organiserName);
  const helpIds = [q.help_text ? `${id}-help` : null, note ? `${id}-note` : null].filter(Boolean).join(' ');
  const helpId = helpIds || undefined;
  const title = `${q.label}${q.required ? '' : ' (optional)'}`;
  const help = (
    <>
      {q.help_text ? <p id={`${id}-help`} className="mt-1 text-xs text-eve-muted">{q.help_text}</p> : null}
      {note ? <p id={`${id}-note`} className="mt-1 text-xs text-eve-ink" data-testid={`note-${q.data_category}`}>{note}</p> : null}
    </>
  );

  switch (q.field_type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      const common = {
        id, required: q.required, maxLength: MAX_LENGTH[q.field_type], 'aria-describedby': helpId,
        value: typeof value === 'string' ? value : '', onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      };
      return (
        <div>
          <label htmlFor={id} className={labelCls}>{title}</label>
          {q.field_type === 'SHORT_TEXT'
            ? <input {...common} className={input} />
            : <textarea {...common} rows={3} className={`${input} py-2`} />}
          {help}
        </div>
      );
    }
    case 'SINGLE_SELECT':
      return (
        <div>
          <label htmlFor={id} className={labelCls}>{title}</label>
          <select id={id} className={input} required={q.required} aria-describedby={helpId}
            value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || undefined)}>
            <option value="">Choose…</option>
            {(q.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {help}
        </div>
      );
    case 'YES_NO':
      return (
        <fieldset aria-describedby={helpId}>
          <legend className={labelCls}>{title}</legend>
          <div className="mt-1 flex gap-6">
            {([['Yes', true], ['No', false]] as const).map(([text, v]) => (
              <label key={text} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={id} required={q.required} checked={value === v} onChange={() => onChange(v)} className="h-5 w-5" />
                {text}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    case 'MULTI_SELECT': {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={helpId}>
          <legend className={labelCls}>{title}</legend>
          <div className="mt-1 space-y-1">
            {(q.options ?? []).map(o => (
              <label key={o} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={chosen.includes(o)}
                  onChange={e => onChange(e.target.checked ? [...chosen, o] : chosen.filter(c => c !== o))} />
                {o}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    default:
      return null;
  }
}
