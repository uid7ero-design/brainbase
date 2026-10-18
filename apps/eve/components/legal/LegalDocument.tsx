import type { ReactNode } from 'react';
import { Container } from '@/components/ui/primitives';
import { LEGAL_LAST_UPDATED, PLACEHOLDERS, getLegalConfig, type LegalConfig, type LegalFactKey } from '@/config/legal';
import type { LegalDoc } from '@/content/legal';

export type Segment = { text: string; placeholder: boolean };

const SIMPLE_TOKENS = new Set(['lastUpdated', 'supportEmail']);

// Splits text on {{token}} markers. A token whose fact is unresolved becomes a
// visibly marked placeholder segment; it is never silently blank and never
// invented.
export function renderTokens(text: string, cfg: LegalConfig): Segment[] {
  const out: Segment[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), placeholder: false });
    const key = m[1];
    if (key === 'lastUpdated') out.push({ text: LEGAL_LAST_UPDATED, placeholder: false });
    else if (key === 'supportEmail') out.push(cfg.supportEmail ? { text: cfg.supportEmail, placeholder: false } : { text: '[SUPPORT EMAIL]', placeholder: true });
    else if (key in PLACEHOLDERS && !SIMPLE_TOKENS.has(key)) {
      const v = cfg.facts[key as LegalFactKey];
      out.push(v ? { text: v, placeholder: false } : { text: PLACEHOLDERS[key as LegalFactKey], placeholder: true });
    } else out.push({ text: m[0], placeholder: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}

function Filled({ text, cfg }: { text: string; cfg: LegalConfig }): ReactNode {
  return renderTokens(text, cfg).map((s, i) =>
    s.placeholder ? <mark key={i} data-placeholder="true" className="rounded bg-amber-100 px-1 text-amber-950">{s.text}</mark> : <span key={i}>{s.text}</span>,
  );
}

// Production fails closed: until every required fact is set and the text is
// explicitly published, no incomplete legal text is shown.
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const cfg = getLegalConfig();
  if (!cfg.showDocuments) {
    return (
      <Container className="max-w-3xl py-16" >
        <section role="status" data-testid="legal-not-published" className="rounded-[var(--radius-eve)] border border-dashed border-eve-line bg-eve-surface-alt p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Not yet published</p>
          <h1 className="mt-2 text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-3 text-sm text-eve-muted">This document is not yet published. If you have a question about your booking, email {cfg.supportEmail ?? 'the event organiser'}.</p>
        </section>
      </Container>
    );
  }
  return (
    <Container className="max-w-3xl py-12 sm:py-16">
      {!cfg.isFinal ? (
        <p role="note" data-testid="legal-draft-banner" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          DRAFT for review: not final legal text. Highlighted items are facts that have not been confirmed yet.
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-sm text-eve-muted">Last updated: {LEGAL_LAST_UPDATED}</p>
      <p className="mt-6 text-eve-ink">{doc.intro}</p>
      {doc.sections.map(s => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-3 leading-relaxed text-eve-ink-soft"><Filled text={p} cfg={cfg} /></p>
          ))}
        </section>
      ))}
    </Container>
  );
}
