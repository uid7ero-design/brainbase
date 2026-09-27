'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FormError, Panel, buttonProps, fieldControlClassName, type SemanticState } from '@/components/ui/app';
import styles from '../Leads.module.css';

const STATUSES: { value: string; label: string; state: SemanticState }[] = [
  { value: 'new',         label: 'New',         state: 'info' },
  { value: 'contacted',   label: 'Contacted',   state: 'warning' },
  { value: 'in_progress', label: 'In Progress', state: 'warning' },
  { value: 'booked',      label: 'Booked',      state: 'success' },
  { value: 'closed',      label: 'Closed',      state: 'inactive' },
  { value: 'cancelled',   label: 'Cancelled',   state: 'error' },
];

export default function LeadStatusPicker({
  leadId,
  currentStatus,
  currentNotes,
}: {
  leadId: string;
  currentStatus: string;
  currentNotes?: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState(currentNotes ?? '');
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();
  const uid = useId();

  const dirty = status !== currentStatus || note !== (currentNotes ?? '');

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const body: Record<string, unknown> = { note };
    if (status !== currentStatus) body.status = status;
    if (notify) body.notify = true;

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSaved(true);
        setNotify(false);
        setTimeout(() => setSaved(false), 2500);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(data.error ?? `Server error (${res.status})`);
      }
    } catch {
      setSaveError('Network error — check your connection');
    }
    setSaving(false);
  }

  return (
    <Panel>
      <div className={styles.editorStack}>
        <div role="group" aria-labelledby={`${uid}-status`}>
          <p id={`${uid}-status`} className={styles.sectionLabel}>Status</p>
          <div className={styles.chips}>
            {STATUSES.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatus(s.value)}
                disabled={saving}
                aria-pressed={status === s.value}
                className={styles.chip}
              >
                <span className={styles.chipDot} data-state={s.state} aria-hidden="true" />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Note">
          {control => (
            <textarea
              {...control}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add a note for the client..."
              rows={3}
              className={fieldControlClassName}
            />
          )}
        </Field>

        {saveError && <FormError>{saveError}</FormError>}

        <div className={styles.footer}>
          <label className={styles.switchLabel}>
            <button
              type="button"
              role="switch"
              aria-checked={notify}
              onClick={() => setNotify(v => !v)}
              className={styles.switch}
            >
              <span className={styles.switchThumb} aria-hidden="true" />
            </button>
            <span>Notify client by email</span>
          </label>

          <button
            type="button"
            onClick={save}
            disabled={saving || (!dirty && !notify)}
            {...buttonProps('primary')}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Update'}
          </button>
        </div>
      </div>
    </Panel>
  );
}
