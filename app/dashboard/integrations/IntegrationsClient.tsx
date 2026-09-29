'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Integration, ConnectorId, TargetTable } from '@/lib/integrations/types';
import {
  PageHeader, Button, Field, FormError, fieldControlClassName, Badge, StateMessage, type SemanticState,
} from '@/components/ui/app';
import s from './Integrations.module.css';

type ConnectorMeta = { id: string; label: string; description: string };

interface Props {
  integrations: Integration[];
  connectors: ConnectorMeta[];
}

const TARGET_LABELS: Record<TargetTable, string> = {
  waste_records:    'Waste',
  fleet_metrics:    'Fleet',
  service_requests: 'Service Requests',
};

// Last-sync status → semantic state (the status word is always written).
const STATUS_STATE: Record<string, SemanticState> = {
  success: 'success',
  error:   'error',
  running: 'syncing',
};

function fmt(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}

export default function IntegrationsClient({ integrations: initial, connectors }: Props) {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<Integration[]>(initial);
  const [syncing, setSyncing]   = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const [form, setForm] = useState({
    name: '',
    connector_id: connectors[0]?.id ?? 'csv-url',
    url: '',
    method: 'GET',
    headers: '',
    financial_year: '',
    month: '',
    target_table: 'waste_records' as TargetTable,
  });

  async function triggerSync(id: string) {
    setSyncing(s => ({ ...s, [id]: true }));
    try {
      const res = await fetch(`/api/integrations/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      router.refresh();
      // Optimistically update status
      setIntegrations(prev => prev.map(i =>
        i.id === id
          ? { ...i, last_sync_status: 'success', last_synced_at: new Date().toISOString(), last_sync_count: data.recordsSynced }
          : i,
      ));
    } catch (err) {
      setIntegrations(prev => prev.map(i =>
        i.id === id ? { ...i, last_sync_status: 'error' } : i,
      ));
    } finally {
      setSyncing(s => ({ ...s, [id]: false }));
    }
  }

  async function toggleEnabled(integration: Integration) {
    await fetch(`/api/integrations/${integration.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ enabled: !integration.enabled }),
    });
    setIntegrations(prev => prev.map(i =>
      i.id === integration.id ? { ...i, enabled: !i.enabled } : i,
    ));
  }

  async function deleteIntegration(id: string) {
    if (!confirm('Delete this integration? Synced data will not be removed.')) return;
    await fetch(`/api/integrations/${id}`, { method: 'DELETE' });
    setIntegrations(prev => prev.filter(i => i.id !== id));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const headersObj: Record<string, string> = {};
      if (form.headers.trim()) {
        for (const line of form.headers.split('\n')) {
          const [k, ...v] = line.split(':');
          if (k?.trim()) headersObj[k.trim()] = v.join(':').trim();
        }
      }

      const config: Record<string, unknown> = { url: form.url };
      if (form.connector_id === 'rest') {
        config.method = form.method;
        if (Object.keys(headersObj).length) config.headers = headersObj;
      }
      if (form.financial_year.trim()) config.financial_year = form.financial_year.trim();
      if (form.month.trim()) config.month = form.month.trim();

      const res = await fetch('/api/integrations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          connector_id: form.connector_id,
          name:         form.name,
          config,
          target_table: form.target_table,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create.');
      setIntegrations(prev => [data.integration, ...prev]);
      setShowAdd(false);
      setForm(f => ({ ...f, name: '', url: '', headers: '', financial_year: '', month: '' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={s.page}>
      <div className={s.inner}>

        {/* Header */}
        <PageHeader
          title="Integrations"
          description="Connect external data sources. Dashboards sync automatically every night at 2 AM."
          actions={
            <Button
              variant={showAdd ? 'secondary' : 'primary'}
              onClick={() => setShowAdd(s => !s)}
              aria-expanded={showAdd}
              aria-controls={showAdd ? 'integration-add-form' : undefined}
            >
              {showAdd ? 'Cancel' : '+ Add Integration'}
            </Button>
          }
        />

        {/* Add form */}
        {showAdd && (
          <form id="integration-add-form" onSubmit={handleAdd} className={s.form} aria-labelledby="integration-add-title">
            <h2 id="integration-add-title" className={s.formTitle}>New Integration</h2>

            {error && <FormError>{error}</FormError>}

            <div className={s.grid2}>
              <Field label="Name">
                {control => (
                  <input
                    {...control}
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Civica Waste API"
                    className={fieldControlClassName}
                  />
                )}
              </Field>

              <Field label="Connector">
                {control => (
                  <select
                    {...control}
                    value={form.connector_id}
                    onChange={e => setForm(f => ({ ...f, connector_id: e.target.value as ConnectorId }))}
                    className={fieldControlClassName}
                  >
                    {connectors.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                )}
              </Field>

              <Field label="Target Table">
                {control => (
                  <select
                    {...control}
                    value={form.target_table}
                    onChange={e => setForm(f => ({ ...f, target_table: e.target.value as TargetTable }))}
                    className={fieldControlClassName}
                  >
                    {(Object.entries(TARGET_LABELS) as [TargetTable, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                )}
              </Field>

              {form.connector_id === 'rest' && (
                <Field label="Method">
                  {control => (
                    <select
                      {...control}
                      value={form.method}
                      onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                      className={fieldControlClassName}
                    >
                      <option>GET</option>
                      <option>POST</option>
                    </select>
                  )}
                </Field>
              )}
            </div>

            <Field label="URL">
              {control => (
                <input
                  {...control}
                  required
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://api.example.com/waste-data"
                  className={`${fieldControlClassName} ${s.mono}`}
                />
              )}
            </Field>

            {form.connector_id === 'rest' && (
              <Field label="Headers (optional, one per line: Key: Value)">
                {control => (
                  <textarea
                    {...control}
                    value={form.headers}
                    onChange={e => setForm(f => ({ ...f, headers: e.target.value }))}
                    rows={3}
                    placeholder={'Authorization: Bearer TOKEN\nX-API-Version: 2'}
                    className={`${fieldControlClassName} ${s.textarea}`}
                  />
                )}
              </Field>
            )}

            <div className={s.grid2}>
              <Field label="Financial Year (optional, e.g. 2025-26)">
                {control => (
                  <input
                    {...control}
                    value={form.financial_year}
                    onChange={e => setForm(f => ({ ...f, financial_year: e.target.value }))}
                    placeholder="2025-26"
                    className={fieldControlClassName}
                  />
                )}
              </Field>
              <Field label="Month (optional, e.g. Jan)">
                {control => (
                  <input
                    {...control}
                    value={form.month}
                    onChange={e => setForm(f => ({ ...f, month: e.target.value }))}
                    placeholder="Jan"
                    className={fieldControlClassName}
                  />
                )}
              </Field>
            </div>

            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Integration'}
              </Button>
            </div>
          </form>
        )}

        {/* Integrations list */}
        {integrations.length === 0 ? (
          <StateMessage kind="empty" size="page" title="No integrations yet. Add one to start auto-syncing your dashboards." />
        ) : (
          <ul className={s.list} aria-label="Integrations">
            {integrations.map(integration => (
              <li key={integration.id} className={s.row}>
                <div className={s.rowMain}>
                  <div className={s.nameLine}>
                    <span className={s.name}>{integration.name}</span>
                    <span className={`${s.tag} ${s.mono}`}>
                      {integration.connector_id}
                    </span>
                    <span className={s.tag}>
                      {TARGET_LABELS[integration.target_table]}
                    </span>
                  </div>
                  <p className={s.url}>
                    {(integration.config as { url?: string }).url ?? ''}
                  </p>
                  <div className={s.syncLine}>
                    <span>Last sync: {fmt(integration.last_synced_at)}</span>
                    {integration.last_sync_status && (
                      <Badge state={STATUS_STATE[integration.last_sync_status] ?? 'inactive'}>
                        {integration.last_sync_status}
                        {integration.last_sync_count != null && ` (${integration.last_sync_count} records)`}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className={s.rowActions}>
                  {/* Enable toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!integration.enabled}
                    aria-label={`Enabled: ${integration.name}`}
                    onClick={() => toggleEnabled(integration)}
                    title={integration.enabled ? 'Disable' : 'Enable'}
                    className={s.switch}
                  >
                    <span className={s.thumb} aria-hidden="true" />
                  </button>

                  {/* Sync now */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => triggerSync(integration.id)}
                    disabled={syncing[integration.id] || !integration.enabled}
                  >
                    {syncing[integration.id] ? 'Syncing…' : 'Sync now'}
                  </Button>

                  {/* Delete */}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => deleteIntegration(integration.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
