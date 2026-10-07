'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

  const mappingQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceFilter) params.set('sourceSystemId', sourceFilter);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [sourceFilter, statusFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sourcesRes, accountsRes, costCentresRes, referenceRes] = await Promise.all([
      fetch('/api/commercial/budgeting/external-gl/sources', { cache: 'no-store' }),
      fetch(`/api/commercial/budgeting/external-gl/mappings${mappingQuery}`, { cache: 'no-store' }),
      fetch(`/api/commercial/budgeting/external-gl/cost-centre-mappings${mappingQuery}`, { cache: 'no-store' }),
      fetch('/api/commercial/budgeting/external-gl/reference-data', { cache: 'no-store' }),
    ]);

    if ([accountsRes, costCentresRes, referenceRes].some(response => response.status === 403)) {
      setError('Budgeting administrator access is required to manage External GL mappings.');
      setLoading(false);
      return;
    }
    if (!sourcesRes.ok || !accountsRes.ok || !costCentresRes.ok || !referenceRes.ok) {
      setError('Unable to load External GL mapping configuration.');
      setLoading(false);
      return;
    }

    const [sourceData, accountData, costCentreData, refData] = await Promise.all([
      sourcesRes.json(),
      accountsRes.json(),
      costCentresRes.json(),
      referenceRes.json(),
    ]);

    setSources(Array.isArray(sourceData.sourceSystemIds) ? sourceData.sourceSystemIds : []);
    setAccountMappings(Array.isArray(accountData.mappings) ? accountData.mappings : []);
    setCostCentreMappings(Array.isArray(costCentreData.mappings) ? costCentreData.mappings : []);
    setReferenceData({
      budgetAccounts: Array.isArray(refData.budgetAccounts) ? refData.budgetAccounts : [],
      costCentres: Array.isArray(refData.costCentres) ? refData.costCentres : [],
    });
    setLoading(false);
  }, [mappingQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function postJson(url: string, body: Record<string, unknown>) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error || 'The External GL mapping change could not be saved.');
        return false;
      }
      return true;
    } finally {
      setWorking(false);
    }
  }

  async function createAccountMapping(event: FormEvent) {
    event.preventDefault();
    const ok = await postJson('/api/commercial/budgeting/external-gl/mappings', {
      sourceSystemId: accountDraft.sourceSystemId,
      externalAccountCode: accountDraft.externalAccountCode,
      externalAccountName: accountDraft.externalAccountName || null,
      budgetAccountId: accountDraft.budgetAccountId,
      effectiveFrom: accountDraft.effectiveFrom,
      effectiveTo: accountDraft.effectiveTo || null,
    });
    if (!ok) return;
    setAccountDraft(EMPTY_ACCOUNT);
    setNotice('GL account mapping created.');
    await loadData();
  }

  async function createCostCentreMapping(event: FormEvent) {
    event.preventDefault();
    const ok = await postJson('/api/commercial/budgeting/external-gl/cost-centre-mappings', {
      sourceSystemId: costCentreDraft.sourceSystemId,
      externalCostCentreCode: costCentreDraft.externalCostCentreCode,
      costCentreId: costCentreDraft.costCentreId,
      effectiveFrom: costCentreDraft.effectiveFrom,
      effectiveTo: costCentreDraft.effectiveTo || null,
    });
    if (!ok) return;
    setCostCentreDraft(EMPTY_COST_CENTRE);
    setNotice('Cost-centre mapping created.');
    await loadData();
  }

  async function retire(kind: 'account' | 'cost-centre', id: string) {
    const effectiveTo = retireDates[id];
    if (!effectiveTo) {
      setError('Choose an effective-to date before retiring a mapping.');
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
    await loadData();
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
        <h1 style={{ margin: 0, fontSize: 24 }}>External GL mappings</h1>
        <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 13, lineHeight: 1.6 }}>
          Explicitly map external GL accounts and cost centres to BrainBase finance dimensions. No fuzzy or automatic matching is used.
        </p>
      </div>

      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Source">
            <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className={fieldControlClassName}>
              <option value="">All sources</option>
              {sources.map(source => <option key={source} value={source}>{source}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'ALL' | MappingStatus)} className={fieldControlClassName}>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
              <option value="ALL">All</option>
            </select>
          </Field>
          <button type="button" onClick={() => void loadData()} disabled={loading || working} {...buttonProps('secondary', 'sm')}>
            Refresh
          </button>
        </div>
      </section>

      {error ? <div role="alert" style={errorBox}>{error}</div> : null}
      {notice ? <div role="status" style={noticeBox}>{notice}</div> : null}

      <MappingSection title="GL account mappings" description="Map an external GL account code to one BrainBase Budget account.">
        <form onSubmit={createAccountMapping} style={formGrid}>
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
            <button type="submit" disabled={working || loading} {...buttonProps('primary', 'sm')}>Create mapping</button>
          </div>
        </form>
        <AccountMappingTable rows={accountMappings} retireDates={retireDates} setRetireDates={setRetireDates} onRetire={id => retire('account', id)} working={working} />
      </MappingSection>

      <MappingSection title="Cost-centre mappings" description="Map an external cost-centre code to one BrainBase cost centre.">
        <form onSubmit={createCostCentreMapping} style={formGrid}>
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
            <button type="submit" disabled={working || loading} {...buttonProps('primary', 'sm')}>Create mapping</button>
          </div>
        </form>
        <CostCentreMappingTable rows={costCentreMappings} retireDates={retireDates} setRetireDates={setRetireDates} onRetire={id => retire('cost-centre', id)} working={working} />
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
        type="date"
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
  return <Field label={label}><input type="date" required={required} value={value} onChange={event => onChange(event.target.value)} className={fieldControlClassName} /></Field>;
}

function dateRange(from: string, to: string | null) {
  const start = from.slice(0, 10);
  return to ? `${start} → ${to.slice(0, 10)}` : `${start} → ongoing`;
}

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 18 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' };
const sub: React.CSSProperties = { color: MUTED, marginTop: 3, fontSize: 11 };
const emptyCell: React.CSSProperties = { color: MUTED, textAlign: 'center', padding: 22 };
const errorBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-muted)', color: 'var(--status-danger)', borderRadius: 8, padding: 10, fontSize: 12 };
const noticeBox: React.CSSProperties = { marginBottom: 14, border: '1px solid var(--status-success-border)', background: 'var(--status-success-muted)', color: 'var(--status-success)', borderRadius: 8, padding: 10, fontSize: 12 };
