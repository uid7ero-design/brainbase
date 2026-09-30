'use client';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Field, FormActions, FormError, fieldControlClassName } from '@/components/ui/app';
import {
  REQUIRES_VERIFICATION_HELP, RISK_CODE_MAX, RISK_DESCRIPTION_MAX, RISK_NAME_MAX, RISK_RANK_MAX,
  SERIOUS_CHANGE_CONFIRMATION, SERIOUS_RULE_TEXT, normaliseRiskCode, type SeriousChangeDetails,
} from '@/lib/assurance/riskLevelRules';
import styles from './assurance.module.css';

// Settings → Risk levels. Renders the server-computed list; every change is
// POSTed to /api/assurance/risk-levels/** where permission, organisation
// scope, uniqueness and the serious-set impact are enforced. When a change
// would alter which levels are serious, the server answers 409 with the
// exact before/after sets; this component shows them and resubmits only
// with an explicit acknowledgement of that exact outcome.

export type RiskLevelView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rank: number;
  is_active: boolean;
  requires_verification: boolean;
  serious: boolean;
  revision: string;
  usage_count: number | null;
};

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; level: RiskLevelView }
  | { kind: 'deactivate'; level: RiskLevelView }
  | { kind: 'reactivate'; level: RiskLevelView };

type Pending = { endpoint: string; body: Record<string, unknown>; details: SeriousChangeDetails };

function classification(l: RiskLevelView): { label: string; state: 'error' | 'info' | 'inactive' } {
  if (!l.is_active) return { label: 'Inactive', state: 'inactive' };
  return l.serious ? { label: 'Serious', state: 'error' } : { label: 'Standard', state: 'info' };
}

function names(list: { name: string }[]): string {
  return list.length ? list.map(l => l.name).join(', ') : 'None';
}

export default function RiskLevelsManager({ levels, canAdminister }: { levels: RiskLevelView[]; canAdminister: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a save the list re-renders from the server. Until that lands the
  // rows still carry the old revision, so their actions stay disabled
  // (acting on stale data would only earn a "changed by someone else").
  const [refreshing, startRefresh] = useTransition();

  function close() { setMode(null); setPending(null); setError(null); setBusy(false); }

  async function submit(endpoint: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.details?.code === SERIOUS_CHANGE_CONFIRMATION) {
        setPending({ endpoint, body, details: data.details as SeriousChangeDetails });
        return;
      }
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Something went wrong. Nothing was saved.'); return; }
      close();
      startRefresh(() => router.refresh());
    } catch {
      setError('Network error. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const title = pending ? 'Confirm serious-risk change'
    : mode?.kind === 'create' ? 'Create risk level'
    : mode?.kind === 'edit' ? `Edit ${mode.level.name}`
    : mode?.kind === 'deactivate' ? `Deactivate ${mode.level.name}`
    : mode?.kind === 'reactivate' ? `Reactivate ${mode.level.name}` : '';

  return (
    <div>
      <div className={styles.riskIntro}>
        <p role="note" className={styles.notice} data-tone="info">{SERIOUS_RULE_TEXT}</p>
        {canAdminister && levels.length > 0 && (
          <Button variant="primary" disabled={refreshing} onClick={() => setMode({ kind: 'create' })}>Create risk level</Button>
        )}
      </div>

      {levels.length === 0 ? (
        <div className={styles.riskEmpty} role="status">
          <p className={styles.riskEmptyTitle}>No risk levels have been configured for this organisation.</p>
          {canAdminister
            ? <Button variant="primary" onClick={() => setMode({ kind: 'create' })}>Create risk level</Button>
            : <p className={styles.dim}>Ask an organisation admin to configure risk levels.</p>}
        </div>
      ) : (
        <>
          <div className={styles.riskTable}>
            <table className={styles.riskTableEl} aria-label="Risk levels">
              <thead>
                <tr>
                  <th scope="col">Name</th><th scope="col">Code</th><th scope="col">Rank</th><th scope="col">Status</th>
                  <th scope="col">Requires verification</th><th scope="col">Classification</th><th scope="col">Description</th>
                  {canAdminister && <th scope="col"><span className="bb-visually-hidden">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {levels.map(l => {
                  const c = classification(l);
                  return (
                    <tr key={l.id} data-inactive={l.is_active ? undefined : 'true'}>
                      <td className={styles.riskName}>{l.name}</td>
                      <td><code className={styles.riskCode}>{l.code}</code></td>
                      <td>{l.rank}</td>
                      <td><Badge state={l.is_active ? 'success' : 'inactive'}>{l.is_active ? 'Active' : 'Inactive'}</Badge></td>
                      <td>{l.requires_verification ? 'Yes' : 'No'}</td>
                      <td><Badge state={c.state}>{c.label}</Badge></td>
                      <td className={styles.riskDescription}>{l.description ?? <span className={styles.dim}>—</span>}</td>
                      {canAdminister && <td className={styles.riskActions}><RowActions level={l} onPick={setMode} disabled={refreshing} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className={styles.riskCards} aria-label="Risk levels">
            {levels.map(l => {
              const c = classification(l);
              return (
                <li key={l.id} className={styles.riskCard} data-inactive={l.is_active ? undefined : 'true'}>
                  <div className={styles.riskCardHead}>
                    <span className={styles.riskName}>{l.name}</span>
                    <Badge state={c.state}>{c.label}</Badge>
                  </div>
                  <dl className={styles.riskCardMeta}>
                    <div><dt>Code</dt><dd><code className={styles.riskCode}>{l.code}</code></dd></div>
                    <div><dt>Rank</dt><dd>{l.rank}</dd></div>
                    <div><dt>Status</dt><dd>{l.is_active ? 'Active' : 'Inactive'}</dd></div>
                    <div><dt>Requires verification</dt><dd>{l.requires_verification ? 'Yes' : 'No'}</dd></div>
                  </dl>
                  {l.description && <p className={styles.riskDescription}>{l.description}</p>}
                  {canAdminister && <div className={styles.riskActions}><RowActions level={l} onPick={setMode} disabled={refreshing} /></div>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {mode && (
        <Dialog open onClose={close} title={title} width={520}>
          {pending ? (
            <SeriousConfirm details={pending.details} busy={busy} error={error}
              onBack={() => { setPending(null); setError(null); }}
              onConfirm={() => submit(pending.endpoint, { ...pending.body, acknowledgeSerious: pending.details.acknowledge })} />
          ) : mode.kind === 'create' || mode.kind === 'edit' ? (
            <LevelForm level={mode.kind === 'edit' ? mode.level : null} busy={busy} error={error} onCancel={close}
              onSubmit={body => submit(mode.kind === 'edit' ? `/api/assurance/risk-levels/${mode.level.id}` : '/api/assurance/risk-levels', body)} />
          ) : (
            <ActiveConfirm level={mode.level} activate={mode.kind === 'reactivate'} busy={busy} error={error} onCancel={close}
              onConfirm={() => submit(`/api/assurance/risk-levels/${mode.level.id}/${mode.kind}`, { expectedRevision: mode.level.revision })} />
          )}
        </Dialog>
      )}
    </div>
  );
}

function RowActions({ level, onPick, disabled }: { level: RiskLevelView; onPick: (m: Mode) => void; disabled: boolean }) {
  return (
    <span className={styles.riskActionButtons}>
      <Button size="sm" disabled={disabled} onClick={() => onPick({ kind: 'edit', level })} aria-label={`Edit ${level.name}`}>Edit</Button>
      {level.is_active
        ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPick({ kind: 'deactivate', level })} aria-label={`Deactivate ${level.name}`}>Deactivate</Button>
        : <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onPick({ kind: 'reactivate', level })} aria-label={`Reactivate ${level.name}`}>Reactivate</Button>}
    </span>
  );
}

function LevelForm({ level, busy, error, onCancel, onSubmit }: {
  level: RiskLevelView | null; busy: boolean; error: string | null; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState('');
  function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: String(f.get('name') ?? ''),
      description: String(f.get('description') ?? ''),
      rank: String(f.get('rank') ?? ''),
      requiresVerification: f.get('requiresVerification') === 'on',
    };
    if (level) body.expectedRevision = level.revision;
    else { body.code = String(f.get('code') ?? ''); body.active = f.get('active') === 'on'; }
    onSubmit(body);
  }
  return (
    <form onSubmit={handle} className={styles.riskForm} noValidate={false}>
      {level ? (
        <Field label="Code" helper="The code is a stable identifier and cannot be changed after the risk level is created.">
          {p => <input {...p} className={fieldControlClassName} value={level.code} readOnly aria-readonly="true" />}
        </Field>
      ) : (
        <Field label="Code" required helper={`Upper-case letters, numbers and underscores, starting with a letter. It cannot be changed later.${code ? ` Saved as ${normaliseRiskCode(code)}.` : ''}`}>
          {p => <input {...p} name="code" className={fieldControlClassName} required maxLength={RISK_CODE_MAX} autoComplete="off"
            value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. CRITICAL" />}
        </Field>
      )}
      <Field label="Name" required>
        {p => <input {...p} name="name" className={fieldControlClassName} required maxLength={RISK_NAME_MAX} defaultValue={level?.name ?? ''} />}
      </Field>
      <Field label="Description">
        {p => <textarea {...p} name="description" className={fieldControlClassName} rows={3} maxLength={RISK_DESCRIPTION_MAX} defaultValue={level?.description ?? ''} />}
      </Field>
      <Field label="Rank" required helper="Higher ranks are more severe. Each rank can be used once in your organisation, including by inactive levels.">
        {p => <input {...p} name="rank" type="number" inputMode="numeric" min={0} max={RISK_RANK_MAX} step={1} required className={fieldControlClassName} defaultValue={level?.rank ?? ''} />}
      </Field>
      <label className={styles.riskCheck}>
        <input type="checkbox" name="requiresVerification" defaultChecked={level?.requires_verification ?? false} aria-describedby="rv-help" />
        <span>Requires verification</span>
      </label>
      <p id="rv-help" className={styles.riskHelp}>{REQUIRES_VERIFICATION_HELP}</p>
      {!level && (
        <label className={styles.riskCheck}>
          <input type="checkbox" name="active" defaultChecked />
          <span>Active (offered when recording new incidents, investigations and findings)</span>
        </label>
      )}
      {error && <FormError>{error}</FormError>}
      <FormActions>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : level ? 'Save changes' : 'Create risk level'}</Button>
      </FormActions>
    </form>
  );
}

function ActiveConfirm({ level, activate, busy, error, onCancel, onConfirm }: {
  level: RiskLevelView; activate: boolean; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  const usage: ReactNode = level.usage_count === null ? null
    : <p className={styles.riskHelp}>Currently used by {level.usage_count} {level.usage_count === 1 ? 'record' : 'records'}.</p>;
  return (
    <div className={styles.riskForm}>
      {activate ? (
        <p className={styles.riskBody}><strong>{level.name}</strong> will be offered again when recording new incidents, investigations and findings.</p>
      ) : (
        <>
          <p className={styles.riskBody}><strong>{level.name}</strong> will no longer be offered when recording new incidents, investigations and findings.</p>
          <p className={styles.riskBody}>Existing records keep this risk level and continue to show it. Nothing is deleted or reassigned.</p>
          {usage}
        </>
      )}
      {error && <FormError>{error}</FormError>}
      <FormActions>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant={activate ? 'primary' : 'danger'} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Working…' : activate ? 'Reactivate' : 'Deactivate'}
        </Button>
      </FormActions>
    </div>
  );
}

function SeriousConfirm({ details, busy, error, onBack, onConfirm }: {
  details: SeriousChangeDetails; busy: boolean; error: string | null; onBack: () => void; onConfirm: () => void;
}) {
  return (
    <div className={styles.riskForm}>
      <p role="alert" className={styles.notice} data-tone="warning">
        Changing this will change which risk levels are treated as serious on the Assurance dashboard.
      </p>
      <dl className={styles.riskImpact}>
        <div><dt>Before</dt><dd>{names(details.before)}</dd></div>
        <div><dt>After</dt><dd>{names(details.after)}</dd></div>
      </dl>
      {error && <FormError>{error}</FormError>}
      <FormActions>
        <Button variant="ghost" onClick={onBack}>Go back</Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Confirm change'}</Button>
      </FormActions>
    </div>
  );
}
