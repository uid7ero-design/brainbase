'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, FormError, fieldControlClassName } from '@/components/ui/app';
import styles from '../../_components/assurance.module.css';

// Links this (existing) evidence to another record. One form: choose the
// kind of record, then the record. The server (linkEvidence) is the only
// authority — organisation scope, visibility, restricted-record reuse,
// frozen targets and duplicate links are all enforced there; this form
// only offers what the page loaded for the viewer.

export type LinkTargetKind = 'incident' | 'investigation' | 'inspection' | 'audit' | 'finding' | 'action';

export const LINK_TARGET_LABELS: Record<LinkTargetKind, string> = {
  incident: 'Incident',
  investigation: 'Investigation',
  inspection: 'Inspection',
  audit: 'Audit',
  finding: 'Finding',
  action: 'Action',
};

const ORDER: LinkTargetKind[] = ['incident', 'investigation', 'inspection', 'audit', 'finding', 'action'];

export default function EvidenceLinkPanel({ evidenceId, options }: {
  evidenceId: string;
  options: Record<LinkTargetKind, { id: string; label: string }[]>;
}) {
  const router = useRouter();
  const kinds = ORDER.filter(k => options[k].length > 0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LinkTargetKind | ''>('');
  const [targetId, setTargetId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (kinds.length === 0) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!kind || !targetId) { setError('Choose the kind of record and the record.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assurance/evidence/${evidenceId}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: kind, targetId, purpose: purpose || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Nothing was saved.'); return; }
      setOpen(false); setKind(''); setTargetId(''); setPurpose('');
      router.refresh();
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ width: open ? '100%' : undefined }}>
      <Button variant={open ? 'ghost' : 'secondary'} aria-expanded={open} onClick={() => { setOpen(o => !o); setError(null); }}>
        {open ? 'Cancel' : 'Link to a record'}
      </Button>
      {open && (
        <div className={styles.disclosure}>
          <div className={styles.disclosureText}>
            Reuse this evidence on another record. The evidence itself is not copied or changed; the link is kept as history.
          </div>
          <form onSubmit={onSubmit} className={styles.form} data-compact="true">
            <Field id="ev-link-kind" label="Record type" required>
              {c => (
                <select {...c} value={kind} required className={fieldControlClassName}
                  onChange={e => { setKind(e.target.value as LinkTargetKind | ''); setTargetId(''); }}>
                  <option value="">Choose…</option>
                  {kinds.map(k => <option key={k} value={k}>{LINK_TARGET_LABELS[k]}</option>)}
                </select>
              )}
            </Field>
            <Field id="ev-link-target" label={kind ? LINK_TARGET_LABELS[kind] : 'Record'} required>
              {c => (
                <select {...c} value={targetId} required disabled={!kind} className={fieldControlClassName}
                  onChange={e => setTargetId(e.target.value)}>
                  <option value="">{kind ? 'Choose…' : 'Choose a record type first'}</option>
                  {kind && options[kind].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              )}
            </Field>
            <Field id="ev-link-purpose" label="Why it is linked">
              {c => <input {...c} type="text" maxLength={500} value={purpose} onChange={e => setPurpose(e.target.value)} className={fieldControlClassName} />}
            </Field>
            {error && <FormError>{error}</FormError>}
            <div>
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Link'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
