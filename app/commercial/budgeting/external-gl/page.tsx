'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { australianDateToIso, formatAustralianDate, isFinanceCalendarDate } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';
import { FinanceWorkflow } from '../../_components/FinanceWorkflow';
import { buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';

const CARD = 'var(--bg-surface)';
const BORDER = 'var(--border)';
const MUTED = 'var(--text-muted)';

type MappingStatus = 'ACTIVE' | 'RETIRED';
type RefItem = { id: string; code: string; name: string };

type AccountMapping = {
  id: string;
  source_system_id: string;
  external_gl_account_code: string;
  external_gl_account_name: string | null;
  budget_account_id: string;
  budget_account_code: string;
  budget_account_name: string;
  effective_from: string;
  effective_to: string | null;
  status: MappingStatus;
};

type CostCentreMapping = {
  id: string;
  source_system_id: string;
  external_cost_centre_code: string;
  cost_centre_id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  effective_from: string;
  effective_to: string | null;
  status: MappingStatus;
};

type ReferenceData = {
  budgetAccounts: RefItem[];
  costCentres: RefItem[];
};

type AccountDraft = {
  sourceSystemId: string;
  externalAccountCode: string;
  externalAccountName: string;
  budgetAccountId: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type CostCentreDraft = {
  sourceSystemId: string;
  externalCostCentreCode: string;
  costCentreId: string;
  effectiveFrom: string;
  effectiveTo: string;
};

const EMPTY_ACCOUNT: AccountDraft = {
  sourceSystemId: '',
  externalAccountCode: '',
  externalAccountName: '',
  budgetAccountId: '',
  effectiveFrom: '',
  effectiveTo: '',
};

const EMPTY_COST_CENTRE: CostCentreDraft = {
  sourceSystemId: '',
  externalCostCentreCode: '',
  costCentreId: '',
  effectiveFrom: '',
  effectiveTo: '',
};

function validMapping(value: unknown, kind: 'account' | 'cost-centre', joined = true): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const fields = kind === 'account'
    ? ['external_gl_account_code', 'budget_account_id', ...(joined ? ['budget_account_code', 'budget_account_name'] : [])]
    : ['external_cost_centre_code', 'cost_centre_id', ...(joined ? ['cost_centre_code', 'cost_centre_name'] : [])];
  return ['id', 'source_system_id', ...fields].every(key => typeof row[key] === 'string' && row[key] !== '')
    && isFinanceCalendarDate(row.effective_from)
    && (row.effective_to === null || (isFinanceCalendarDate(row.effective_to) && row.effective_to >= row.effective_from))
    && (row.status === 'ACTIVE' || row.status === 'RETIRED')
    && (kind !== 'account' || row.external_gl_account_name === null || typeof row.external_gl_account_name === 'string');
}
function validReferences(value: unknown): value is RefItem[] {
  return Array.isArray(value) && value.every(row => row && ['id', 'code', 'name'].every(key => typeof row[key] === 'string' && row[key] !== ''));
}

export default function ExternalGlMappingsPage() {
  const [sources, setSources] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MappingStatus>('ACTIVE');
  const [accountMappings, setAccountMappings] = useState<AccountMapping[]>([]);
  const [costCentreMappings, setCostCentreMappings] = useState<CostCentreMapping[]>([]);
  const [referenceData, setReferenceData] = useState<ReferenceData>({ budgetAccounts: [], costCentres: [] });
  const [accountDraft, setAccountDraft] = useState<AccountDraft>(EMPTY_ACCOUNT);
  const [costCentreDraft, setCostCentreDraft] = useState<CostCentreDraft>(EMPTY_COST_CENTRE);
  const [retireDates, setRetireDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const requestSerial = useRef(0);
  const operation = useRef(false);
  const blocked = useRef(true);
  const recoveryRequired = useRef(false);
  const review = useRef<HTMLHeadingElement>(null);
  const locked = loading || working || needsReload || !loaded;
  const invalidateReads = useCallback(() => { requestSerial.current++; }, []);

  const mappingQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter) params.set('sourceSystemId', sourceFilter);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [sourceFilter, statusFilter]);

  const loadData = useCallback(async () => {
    const serial = ++requestSerial.current;
    blocked.current = true;
    setLoading(true);
    setError(null);
    try {
      const responses = await Promise.all([
        fetch('/api/commercial/budgeting/external-gl/sources', { cache: 'no-store' }),
        fetch(`/api/commercial/budgeting/external-gl/mappings${mappingQuery}`, { cache: 'no-store' }),
        fetch(`/api/commercial/budgeting/external-gl/cost-centre-mappings${mappingQuery}`, { cache: 'no-store' }),
        fetch('/api/commercial/budgeting/external-gl/reference-data', { cache: 'no-store' }),
      ]);
      if (serial !== requestSerial.current) return false;
      if (responses.some(response => response.status === 403)) {
        throw new Error('Budgeting administrator access is required to manage External GL mappings.');
      }
      if (responses.some(response => !response.ok)) throw new Error('Unable to load External GL mapping configuration.');
      const [sourceData, accountData, costCentreData, refData] = await Promise.all(responses.map(response => response.json()));
      if (serial !== requestSerial.current) return false;
      if (!Array.isArray(sourceData?.sourceSystemIds) || !sourceData.sourceSystemIds.every((value: unknown) => typeof value === 'string')
        || !Array.isArray(accountData?.mappings) || !accountData.mappings.every((row: unknown) => validMapping(row, 'account'))
        || !Array.isArray(costCentreData?.mappings) || !costCentreData.mappings.every((row: unknown) => validMapping(row, 'cost-centre'))
        || !validReferences(refData?.budgetAccounts) || !validReferences(refData?.costCentres)) {
        throw new Error('Unable to load External GL mapping configuration. The saved view is incomplete.');
      }
      setSources(sourceData.sourceSystemIds);
      setAccountMappings(accountData.mappings);
      setCostCentreMappings(costCentreData.mappings);
      setReferenceData({ budgetAccounts: refData.budgetAccounts, costCentres: refData.costCentres });
      setLoaded(true);
      setNeedsReload(false);
      recoveryRequired.current = false;
      blocked.current = false;
      return true;
    } catch (failure) {
      if (serial !== requestSerial.current) return false;
      setNeedsReload(true);
      recoveryRequired.current = true;
      setError(failure instanceof Error ? failure.message : 'Unable to load External GL mapping configuration.');
      return false;
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }, [mappingQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => { window.clearTimeout(timer); invalidateReads(); };
  }, [loadData, invalidateReads]);

  function changeFilters(change: () => void) {
    if (operation.current || recoveryRequired.current) return;
    requestSerial.current++;
    blocked.current = true;
    setLoading(true);
    setNotice(null);
    change();
  }

  async function reloadSavedMappings() {
    if (operation.current || loading) return;
    operation.current = true;
    setWorking(true);
    setNotice(null);
    try {
      if (!await loadData()) return;
      setAccountDraft(EMPTY_ACCOUNT);
      setCostCentreDraft(EMPTY_COST_CENTRE);
      setRetireDates({});
      setNotice('Saved mappings reloaded. Review the saved records before continuing. Unsaved entries have been cleared.');
      review.current?.focus({ preventScroll: true });
      review.current?.scrollIntoView({ block: 'start' });
    } finally { operation.current = false; setWorking(false); }
  }

  async function postJson(url: string, body: Record<string, unknown>) {
    if (operation.current || blocked.current || locked) return false;
    operation.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    let outcome: 'sent' | 'confirmed' | 'rejected' = 'sent';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      outcome = response.ok ? 'confirmed' : response.status < 500 ? 'rejected' : 'sent';
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'The External GL mapping change could not be saved.');
      const kind = url.includes('/cost-centre-mappings') ? 'cost-centre' : 'account';
      const expected = url.endsWith('/retire')
        ? { id: decodeURIComponent(url.split('/').at(-2)!), status: 'RETIRED', effective_to: body.effectiveTo }
        : { source_system_id: String(body.sourceSystemId).trim(), status: 'ACTIVE',
          effective_from: body.effectiveFrom, effective_to: body.effectiveTo,
          ...(kind === 'account'
            ? { external_gl_account_code: String(body.externalAccountCode).trim(), budget_account_id: body.budgetAccountId,
              external_gl_account_name: typeof body.externalAccountName === 'string' ? body.externalAccountName.trim() || null : null }
            : { external_cost_centre_code: String(body.externalCostCentreCode).trim(), cost_centre_id: body.costCentreId }) };
      if (!validMapping(payload?.mapping, kind, false)
        || !Object.entries(expected).every(([key, value]) => payload.mapping[key] === value)) {
        throw new Error('Incomplete mapping save response.');
      }
      if (!await loadData()) throw new Error('Saved mapping readback unavailable.');
      return true;
    } catch (failure) {
      if (outcome !== 'rejected') {
        blocked.current = true;
        setNeedsReload(true);
        recoveryRequired.current = true;
        setError(outcome === 'confirmed'
          ? 'The mapping change was saved, but its saved view could not be confirmed. Reload saved mappings before continuing.'
          : 'The mapping save outcome could not be confirmed. Reload saved mappings before continuing.');
      } else setError(failure instanceof Error ? failure.message : 'The External GL mapping change could not be saved.');
      return false;
    } finally { operation.current = false; setWorking(false); }
  }

  function mappingDates(form: EventTarget & Element) {
    const fields = new FormData(form as HTMLFormElement);
    try {
      const effectiveFrom = australianDateToIso(String(fields.get('effectiveFrom') ?? ''));
      const inputTo = String(fields.get('effectiveTo') ?? '').trim();
      const effectiveTo = inputTo ? australianDateToIso(inputTo) : null;
      if (effectiveTo && effectiveTo < effectiveFrom) throw new Error('Effective to must be on or after effective from.');
      return { effectiveFrom, effectiveTo };
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check the effective dates.');
      return null;
    }
  }

  async function createAccountMapping(event: FormEvent) {
    event.preventDefault();
    if (operation.current || blocked.current || locked) return;
    const dates = mappingDates(event.currentTarget);
    if (!dates) return;
    const ok = await postJson('/api/commercial/budgeting/external-gl/mappings', {
      sourceSystemId: accountDraft.sourceSystemId,
      externalAccountCode: accountDraft.externalAccountCode,
      externalAccountName: accountDraft.externalAccountName || null,
      budgetAccountId: accountDraft.budgetAccountId,
      ...dates,
    });
    if (!ok) return;
    setAccountDraft(EMPTY_ACCOUNT);
    setNotice('GL account mapping created.');
  }

  async function createCostCentreMapping(event: FormEvent) {
    event.preventDefault();
    if (operation.current || blocked.current || locked) return;
    const dates = mappingDates(event.currentTarget);
    if (!dates) return;
    const ok = await postJson('/api/commercial/budgeting/external-gl/cost-centre-mappings', {
      sourceSystemId: costCentreDraft.sourceSystemId,
      externalCostCentreCode: costCentreDraft.externalCostCentreCode,
      costCentreId: costCentreDraft.costCentreId,
      ...dates,
    });
    if (!ok) return;
    setCostCentreDraft(EMPTY_COST_CENTRE);
    setNotice('Cost-centre mapping created.');
  }

  async function retire(kind: 'account' | 'cost-centre', id: string) {
    if (operation.current || blocked.current || locked) return;
    const enteredDate = retireDates[id];
    let effectiveTo = enteredDate;
    if (!effectiveTo) {
      setError('Choose an effective-to date before retiring a mapping.');
      return;
    }
    try {
      effectiveTo = australianDateToIso(enteredDate);
      const row = (kind === 'account' ? accountMappings : costCentreMappings).find(mapping => mapping.id === id);
      if (!row || effectiveTo < row.effective_from) throw new Error('Effective to must be on or after effective from.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check the effective-to date.');
      return;
    }
    const base = kind === 'account'
      ? '/api/commercial/budgeting/external-gl/mappings'
      : '/api/commercial/budgeting/external-gl/cost-centre-mappings';
    const ok = await postJson(`${base}/${encodeURIComponent(id)}/retire`, { effectiveTo });
    if (!ok) return;
    setRetireDates(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setNotice(kind === 'account' ? 'GL account mapping retired.' : 'Cost-centre mapping retired.');
  }

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
          <Link href="/commercial" style={{ color: MUTED }}>Commercial</Link>
          {' / '}
          <Link href="/commercial/budgeting/commitments" style={{ color: MUTED }}>Budgeting</Link>
          {' / External GL'}
        </div>
        <h1 ref={review} tabIndex={-1} style={{ margin: 0, fontSize: 24, scrollMarginTop: 200 }}>External GL mappings</h1>
        <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 13, lineHeight: 1.6 }}>
          Explicitly map external GL accounts and cost centres to BrainBase finance dimensions. No fuzzy or automatic matching is used.
        </p>
      </div>

      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Source">
            <select value={sourceFilter} disabled={working || needsReload} onChange={event => { const value = event.target.value; if (value !== sourceFilter) changeFilters(() => setSourceFilter(value)); }} className={fieldControlClassName}>
              <option value="">All sources</option>
              {sources.map(source => <option key={source} value={source}>{source}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={statusFilter} disabled={working || needsReload} onChange={event => { const value = event.target.value as 'ALL' | MappingStatus; if (value !== statusFilter) changeFilters(() => setStatusFilter(value)); }} className={fieldControlClassName}>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
              <option value="ALL">All</option>
            </select>
          </Field>
          <button type="button" onClick={() => void reloadSavedMappings()} disabled={loading || working} {...buttonProps('secondary', 'sm')}>
            Reload saved mappings
          </button>
        </div>
      </section>

      {error ? <div role="alert" style={errorBox}>{error}</div> : null}
      {notice ? <div role="status" style={noticeBox}>{notice}</div> : null}

      {loading ? <p role="status">Loading saved mappings…</p> : null}
      {needsReload ? <p>Changes are paused until saved mappings can be checked. Previously loaded records may be out of date.</p> : null}
      {!loading && !needsReload && !error && <FinanceWorkflow current="mappings" setupHint={referenceData.budgetAccounts.length === 0 || referenceData.costCentres.length === 0 ? 'Create active Budget accounts and cost centres in Finance setup before adding External GL mappings.' : undefined} />}

      <MappingSection title="GL account mappings" description="Map an external GL account code to one BrainBase Budget account. Dates use DD/MM/YYYY; leave Effective to blank for an ongoing mapping.">
        <form aria-label="Create GL account mapping" onSubmit={createAccountMapping}><fieldset disabled={locked} className={styles.mappingGrid}>
          <TextInput label="Source system" value={accountDraft.sourceSystemId} onChange={value => setAccountDraft(current => ({ ...current, sourceSystemId: value }))} required />
          <TextInput label="External GL code" value={accountDraft.externalAccountCode} onChange={value => setAccountDraft(current => ({ ...current, externalAccountCode: value }))} required />
          <TextInput label="External name" value={accountDraft.externalAccountName} onChange={value => setAccountDraft(current => ({ ...current, externalAccountName: value }))} />
          <Field label="BrainBase Budget account">
            <select required value={accountDraft.budgetAccountId} onChange={event => setAccountDraft(current => ({ ...current, budgetAccountId: event.target.value }))} className={fieldControlClassName}>
              <option value="">Choose account</option>
              {referenceData.budgetAccounts.map(account => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </select>
          </Field>
          <DateInput label="Effective from" value={accountDraft.effectiveFrom} onChange={value => setAccountDraft(current => ({ ...current, effectiveFrom: value }))} required />
          <DateInput label="Effective to" value={accountDraft.effectiveTo} onChange={value => setAccountDraft(current => ({ ...current, effectiveTo: value }))} />
          <div style={{ alignSelf: 'end' }}>
            <button type="submit" disabled={locked} {...buttonProps('primary', 'sm')}>Create mapping</button>
          </div>
        </fieldset></form>
        {loaded ? <AccountMappingTable rows={accountMappings} retireDates={retireDates} setRetireDates={setRetireDates} onRetire={id => retire('account', id)} working={locked} /> : <p>Saved mappings are not available yet.</p>}
      </MappingSection>

      <MappingSection title="Cost-centre mappings" description="Map an external cost-centre code to one BrainBase cost centre. Dates use DD/MM/YYYY; leave Effective to blank for an ongoing mapping.">
        <form aria-label="Create cost-centre mapping" onSubmit={createCostCentreMapping}><fieldset disabled={locked} className={styles.mappingGrid}>
          <TextInput label="Source system" value={costCentreDraft.sourceSystemId} onChange={value => setCostCentreDraft(current => ({ ...current, sourceSystemId: value }))} required />
          <TextInput label="External cost-centre code" value={costCentreDraft.externalCostCentreCode} onChange={value => setCostCentreDraft(current => ({ ...current, externalCostCentreCode: value }))} required />
          <Field label="BrainBase cost centre">
            <select required value={costCentreDraft.costCentreId} onChange={event => setCostCentreDraft(current => ({ ...current, costCentreId: event.target.value }))} className={fieldControlClassName}>
              <option value="">Choose cost centre</option>
              {referenceData.costCentres.map(costCentre => (
                <option key={costCentre.id} value={costCentre.id}>{costCentre.code} — {costCentre.name}</option>
              ))}
            </select>
          </Field>
          <DateInput label="Effective from" value={costCentreDraft.effectiveFrom} onChange={value => setCostCentreDraft(current => ({ ...current, effectiveFrom: value }))} required />
          <DateInput label="Effective to" value={costCentreDraft.effectiveTo} onChange={value => setCostCentreDraft(current => ({ ...current, effectiveTo: value }))} />
          <div style={{ alignSelf: 'end' }}>
            <button type="submit" disabled={locked} {...buttonProps('primary', 'sm')}>Create mapping</button>
          </div>
        </fieldset></form>
        {loaded ? <CostCentreMappingTable rows={costCentreMappings} retireDates={retireDates} setRetireDates={setRetireDates} onRetire={id => retire('cost-centre', id)} working={locked} /> : <p>Saved mappings are not available yet.</p>}
      </MappingSection>
    </div>
  );
}

function MappingSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ ...panel, marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
      <p style={{ margin: '6px 0 18px', fontSize: 12, color: MUTED }}>{description}</p>
      {children}
    </section>
  );
}

function AccountMappingTable({
  rows, retireDates, setRetireDates, onRetire, working,
}: {
  rows: AccountMapping[];
  retireDates: Record<string, string>;
  setRetireDates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRetire: (id: string) => void;
  working: boolean;
}) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 18 }}>
      <table className={tableStyles.table}>
        <thead><tr>{['Source','External account','BrainBase account','Effective','Status','Retire'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={6} style={emptyCell}>No account mappings match the current filters.</td></tr> : rows.map(row => (
            <tr key={row.id}>
              <td>{row.source_system_id}</td>
              <td><strong>{row.external_gl_account_code}</strong>{row.external_gl_account_name ? <div style={sub}>{row.external_gl_account_name}</div> : null}</td>
              <td>{row.budget_account_code}<div style={sub}>{row.budget_account_name}</div></td>
              <td>{dateRange(row.effective_from, row.effective_to)}</td>
              <td>{row.status}</td>
              <td>{row.status === 'ACTIVE' ? <RetireControl id={row.id} value={retireDates[row.id] ?? ''} setRetireDates={setRetireDates} onRetire={onRetire} working={working} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostCentreMappingTable({
  rows, retireDates, setRetireDates, onRetire, working,
}: {
  rows: CostCentreMapping[];
  retireDates: Record<string, string>;
  setRetireDates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRetire: (id: string) => void;
  working: boolean;
}) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 18 }}>
      <table className={tableStyles.table}>
        <thead><tr>{['Source','External cost centre','BrainBase cost centre','Effective','Status','Retire'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={6} style={emptyCell}>No cost-centre mappings match the current filters.</td></tr> : rows.map(row => (
            <tr key={row.id}>
              <td>{row.source_system_id}</td>
              <td><strong>{row.external_cost_centre_code}</strong></td>
              <td>{row.cost_centre_code}<div style={sub}>{row.cost_centre_name}</div></td>
              <td>{dateRange(row.effective_from, row.effective_to)}</td>
              <td>{row.status}</td>
              <td>{row.status === 'ACTIVE' ? <RetireControl id={row.id} value={retireDates[row.id] ?? ''} setRetireDates={setRetireDates} onRetire={onRetire} working={working} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RetireControl({
  id, value, setRetireDates, onRetire, working,
}: {
  id: string;
  value: string;
  setRetireDates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRetire: (id: string) => void;
  working: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, minWidth: 220 }}>
      <input
        aria-label="Effective-to date"
        type="text"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        disabled={working}
        value={value}
        onChange={event => setRetireDates(current => ({ ...current, [id]: event.target.value }))}
        className={fieldControlClassName} style={{ minWidth: 135 }}
      />
      <button type="button" disabled={working || !value} onClick={() => onRetire(id)} {...buttonProps('danger', 'sm')}>Retire</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'grid', gap: 5, fontSize: 11, color: MUTED }}>{label}{children}</label>;
}

function TextInput({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field label={label}><input required={required} value={value} onChange={event => onChange(event.target.value)} className={fieldControlClassName} /></Field>;
}

function DateInput({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field label={label}><input type="text" name={label === 'Effective from' ? 'effectiveFrom' : 'effectiveTo'} placeholder="DD/MM/YYYY" maxLength={10} required={required} value={value} onChange={event => onChange(event.target.value)} className={fieldControlClassName} /></Field>;
}

function dateRange(from: string, to: string | null) {
  const start = formatAustralianDate(from);
  return to ? `${start} → ${formatAustralianDate(to)}` : `${start} → ongoing`;
}

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 18 };
const sub: React.CSSProperties = { color: MUTED, marginTop: 3, fontSize: 11 };
const emptyCell: React.CSSProperties = { color: MUTED, textAlign: 'center', padding: 22 };
const errorBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-muted)', color: 'var(--status-danger)', borderRadius: 8, padding: 10, fontSize: 12 };
const noticeBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-success-border)', background: 'var(--status-success-muted)', color: 'var(--status-success)', borderRadius: 8, padding: 10, fontSize: 12 };
