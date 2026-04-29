'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Integration, ConnectorId, TargetTable } from '@/lib/integrations/types';

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

const STATUS_COLOURS: Record<string, string> = {
  success: 'text-green-400',
  error:   'text-red-400',
  running: 'text-yellow-400',
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
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6 md:p-10">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
            <p className="text-sm text-gray-400 mt-1">
              Connect external data sources. Dashboards sync automatically every night at 2 AM.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(s => !s)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Integration'}
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <form onSubmit={handleAdd} className="mb-8 p-5 rounded-xl bg-[#13131a] border border-white/10 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 mb-2">New Integration</h2>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name">
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Civica Waste API"
                  className={inputCls}
                />
              </Field>

              <Field label="Connector">
                <select
                  value={form.connector_id}
                  onChange={e => setForm(f => ({ ...f, connector_id: e.target.value as ConnectorId }))}
                  className={inputCls}
                >
                  {connectors.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Target Table">
                <select
                  value={form.target_table}
                  onChange={e => setForm(f => ({ ...f, target_table: e.target.value as TargetTable }))}
                  className={inputCls}
                >
                  {(Object.entries(TARGET_LABELS) as [TargetTable, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </Field>

              {form.connector_id === 'rest' && (
                <Field label="Method">
                  <select
                    value={form.method}
                    onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                    className={inputCls}
                  >
                    <option>GET</option>
                    <option>POST</option>
                  </select>
                </Field>
              )}
            </div>

            <Field label="URL">
              <input
                required
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://api.example.com/waste-data"
                className={inputCls}
              />
            </Field>

            {form.connector_id === 'rest' && (
              <Field label="Headers (optional, one per line: Key: Value)">
                <textarea
                  value={form.headers}
                  onChange={e => setForm(f => ({ ...f, headers: e.target.value }))}
                  rows={3}
                  placeholder={'Authorization: Bearer TOKEN\nX-API-Version: 2'}
                  className={inputCls}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Financial Year (optional, e.g. 2025-26)">
                <input
                  value={form.financial_year}
                  onChange={e => setForm(f => ({ ...f, financial_year: e.target.value }))}
                  placeholder="2025-26"
                  className={inputCls}
                />
              </Field>
              <Field label="Month (optional, e.g. Jan)">
                <input
                  value={form.month}
                  onChange={e => setForm(f => ({ ...f, month: e.target.value }))}
                  placeholder="Jan"
                  className={inputCls}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {saving ? 'Saving...' : 'Save Integration'}
            </button>
          </form>
        )}

        {/* Integrations list */}
        {integrations.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            No integrations yet. Add one to start auto-syncing your dashboards.
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map(integration => (
              <div
                key={integration.id}
                className="p-4 rounded-xl bg-[#13131a] border border-white/10 flex flex-col md:flex-row md:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{integration.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400 shrink-0">
                      {integration.connector_id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400 shrink-0">
                      {TARGET_LABELS[integration.target_table]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {(integration.config as { url?: string }).url ?? ''}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs">
                    <span className="text-gray-500">Last sync: {fmt(integration.last_synced_at)}</span>
                    {integration.last_sync_status && (
                      <span className={STATUS_COLOURS[integration.last_sync_status] ?? 'text-gray-400'}>
                        {integration.last_sync_status}
                        {integration.last_sync_count != null && ` (${integration.last_sync_count} records)`}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Enable toggle */}
                  <button
                    onClick={() => toggleEnabled(integration)}
                    title={integration.enabled ? 'Disable' : 'Enable'}
                    className={`w-10 h-5 rounded-full relative transition-colors ${integration.enabled ? 'bg-blue-600' : 'bg-white/20'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${integration.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                    />
                  </button>

                  {/* Sync now */}
                  <button
                    onClick={() => triggerSync(integration.id)}
                    disabled={syncing[integration.id] || !integration.enabled}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 transition-colors"
                  >
                    {syncing[integration.id] ? 'Syncing…' : 'Sync now'}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => deleteIntegration(integration.id)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-red-900/40 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500';
