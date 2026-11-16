'use client';
import { useRef, useState } from 'react';
import PreviousClassHandover, { type PreviousClass } from './PreviousClassHandover';
import styles from '../../workspace.module.css';

type Receipt = { version?: number; error?: string; recovery?: boolean };
export default function ClassReview({ review, canEdit, save }: {
  review: { finished: boolean; note: string | null; version: number; previous: PreviousClass | null };
  canEdit: boolean;
  save: (version:number,note:string) => Promise<Receipt>;
}) {
  const [draft,setDraft] = useState(review.note ?? '');
  const [version,setVersion] = useState(review.version);
  const [saved,setSaved] = useState(review.note ?? '');
  const [busy,setBusy] = useState(false);
  const [blocked,setBlocked] = useState(false);
  const [message,setMessage] = useState('');
  const pending = useRef(false);
  async function submit() {
    if (pending.current || blocked) return;
    pending.current = true;
    setBusy(true);
    try {
      const receipt = await save(version,draft);
      if (receipt.version) {
        setVersion(receipt.version);
        setSaved(draft.trim());
        setDraft(draft.trim());
        setMessage('Class review saved.');
      } else {
        setBlocked(!!receipt.recovery);
        setMessage(receipt.error ?? 'Check the saved class review.');
      }
    } catch {
      setBlocked(true);
      setMessage('Save could not be confirmed. Reload to check the saved note.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <>
    {review.previous && <PreviousClassHandover previous={review.previous} />}
    {review.finished && (canEdit || review.note) && <section aria-label="Class review" className={styles.panel}>
      <h2>Class review</h2>
      {canEdit ? <>
        <label>Coaching handover
          <textarea className={styles.handoverInput} rows={4} value={draft} maxLength={1500} disabled={busy || blocked}
            onChange={event => { setDraft(event.target.value); setMessage(''); }}/>
        </label>
        <p>Record what worked and what to practise next. For term classes, staff can read this note on the next class date.</p>
        <button disabled={busy || blocked || !draft.trim() || draft.trim() === saved} onClick={submit}>
          {busy ? 'Saving…' : 'Save class review'}
        </button>
        {message && <p role={blocked ? 'alert' : 'status'}>{message}</p>}
        {blocked && <button onClick={() => { if (window.confirm('Replace the displayed draft with the saved review?')) window.location.reload(); }}>Reload saved review</button>}
      </> : <p className={styles.handoverNote}>{review.note}</p>}
    </section>}
  </>;
}
