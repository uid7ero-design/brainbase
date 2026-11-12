'use client';
import { useEffect, useRef, useState } from 'react';
import { newDrill, templateDrills, type Drill, type Player, type Layout } from '@/lib/scheduling/trainingPlan';
import PositionsBoard from './PositionsBoard';
import styles from './plan.module.css';

type Template = { name: string; drills: Drill[] };
type Receipt = { version?: number; error?: string; recovery?: boolean };
export default function TrainingEditor({
  initial,
  defaultLayout = 'blank',
  version,
  editable,
  minutes,
  players,
  templates,
  save,
}: {
  initial: Drill[] | null;
  defaultLayout?: Layout;
  version: number;
  editable: boolean;
  minutes: number;
  players: Player[];
  templates: Template[];
  save: (version: number, drills: Drill[], template: string) => Promise<Receipt>;
}) {
  const [drills, setDrills] = useState<Drill[]>(initial ?? [newDrill(defaultLayout)]);
  const [index, setIndex] = useState(0);
  const [revision, setRevision] = useState(version);
  const [run, setRun] = useState(!editable);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [template, setTemplate] = useState('');
  const [selected, setSelected] = useState('');
  const [library, setLibrary] = useState(templates);
  const [recovery, setRecovery] = useState(false);
  const leaving = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function replace(next: Drill[]) {
    setDrills(next);
    setDirty(true);
    setNotice('');
    setError('');
  }
  function patch(part: Partial<Drill>) {
    replace(drills.map((d, i) => (i === index ? { ...d, ...part } : d)));
  }
  async function submit() {
    if (saving.current || recovery) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const receipt = await save(revision, drills, template);
      if (!receipt.version) {
        setRecovery(receipt.recovery === true);
        setError(receipt.error ?? 'Review the saved plan.');
        return;
      }
      setRevision(receipt.version);
      setDirty(false);
      setNotice('Plan saved.');
      if (template.trim()) {
        setLibrary([...library, { name: template.trim(), drills: templateDrills(drills) }]);
        setTemplate('');
      }
    } catch {
      setRecovery(true);
      setError('Save could not be confirmed. Reload and check the saved plan.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!editable && !initial) return <p>No training plan was saved for this session.</p>;
  const drill = drills[index];
  const total = drills.reduce((sum, d) => sum + d.minutes, 0);
  return (
    <fieldset disabled={busy} className={styles.editor} aria-label="Session planner">
      <div className={styles.saveState}>
        <p role="status">
          {busy
            ? 'Saving plan…'
            : recovery
              ? 'Saved state needs checking'
              : dirty
                ? 'Unsaved draft'
                : revision
                  ? 'Saved plan · version ' + revision
                  : 'New plan · not saved'}
        </p>
        {run && dirty && <p>You are running your unsaved draft. Save it to use it again later.</p>}
        {recovery && (
          <div role="alert">
            <p>{error}</p>
            <p>
              Your draft remains here to review. Check the saved plan before making another change.
            </p>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    'Reload the saved plan? This replaces the draft shown here with the latest saved version.',
                  )
                ) {
                  leaving.current = true;
                  window.location.reload();
                }
              }}
            >
              Reload saved plan
            </button>
          </div>
        )}
      </div>
      <div className={styles.summary}>
        <div>
          <strong>
            {total} / {minutes} min
          </strong>
          <p>
            {total > minutes
              ? total - minutes + ' min over time'
              : minutes - total + ' min remaining'}
          </p>
        </div>
        {editable && (
          <button onClick={() => setRun(!run)}>{run ? 'Edit drills' : 'Run session'}</button>
        )}
      </div>
      <fieldset disabled={recovery && !run} className={styles.editor}>
        <div className={styles.workspace}>
          <aside>
            <h2>Session order</h2>
            <ol className={styles.order}>
              {drills.map((d, i) => (
                <li key={i}>
                  <button
                    aria-current={index === i ? 'step' : undefined}
                    onClick={() => setIndex(i)}
                  >
                    {i + 1}. {d.name || 'Untitled drill'} <small>{d.minutes} min</small>
                  </button>
                </li>
              ))}
            </ol>
            {!run && (
              <button
                disabled={drills.length >= 30}
                onClick={() => {
                  replace([...drills, newDrill(drills[index].layout)]);
                  setIndex(drills.length);
                }}
              >
                Add drill
              </button>
            )}
          </aside>
          <section className={styles.detail}>
            {run ? (
              <>
                <h2>
                  {drill.name || 'Untitled drill'} · {drill.minutes} min
                </h2>
                <p>{drill.notes}</p>
              </>
            ) : (
              <>
                <div className={styles.tools}>
                  <label>
                    Drill name
                    <input
                      value={drill.name}
                      maxLength={100}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Minutes
                    <input
                      type="number"
                      min="1"
                      max="240"
                      value={drill.minutes || ''}
                      onChange={(e) => patch({ minutes: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  Coaching notes
                  <textarea
                    value={drill.notes}
                    maxLength={1500}
                    onChange={(e) => patch({ notes: e.target.value })}
                  />
                </label>
              </>
            )}
            <PositionsBoard
              key={index + '-' + run}
              drill={drill}
              players={players}
              change={run ? undefined : patch}
            />
            {run ? (
              <div className={styles.tools}>
                <button disabled={!index} onClick={() => setIndex(index - 1)}>
                  Previous drill
                </button>
                <button disabled={index === drills.length - 1} onClick={() => setIndex(index + 1)}>
                  Next drill
                </button>
                <span>
                  {drills[index + 1]
                    ? 'Next: ' + (drills[index + 1].name || 'Untitled drill')
                    : 'Final drill'}
                </span>
              </div>
            ) : (
              <div className={styles.tools}>
                <button
                  disabled={!index}
                  onClick={() => {
                    const next = [...drills];
                    [next[index - 1], next[index]] = [drill, next[index - 1]];
                    replace(next);
                    setIndex(index - 1);
                  }}
                >
                  Move earlier
                </button>
                <button
                  disabled={drills.length === 1}
                  onClick={() => {
                    replace(drills.filter((_, i) => i !== index));
                    setIndex(Math.max(0, index - 1));
                  }}
                >
                  Remove drill
                </button>
              </div>
            )}
          </section>
        </div>
        {!run && (
          <div className={styles.footer}>
            {library.length > 0 && (
              <div className={styles.tools}>
                <label>
                  Saved templates
                  <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                    <option value="">Choose template</option>
                    {library.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!selected}
                  onClick={() => {
                    const t = library.find((t) => t.name === selected);
                    if (
                      t &&
                      window.confirm('Replace the drills in this draft with the template?')
                    ) {
                      replace(structuredClone(t.drills));
                      setIndex(0);
                    }
                  }}
                >
                  Use template
                </button>
              </div>
            )}
            <div className={styles.tools}>
              <label>
                Save as a reusable template (optional)
                <input
                  maxLength={100}
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    setDirty(true);
                    setNotice('');
                  }}
                />
              </label>
              <button className={styles.save} onClick={submit}>
                Save plan
              </button>
            </div>
          </div>
        )}
      </fieldset>
      {dirty && <p>Unsaved changes</p>}
      {notice && <p role="status">{notice}</p>}
      {error && !recovery && <p role="alert">{error}</p>}
    </fieldset>
  );
}
