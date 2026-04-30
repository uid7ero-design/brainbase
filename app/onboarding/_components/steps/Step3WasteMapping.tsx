'use client';

import { useState, useRef } from 'react';
import { MappingData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const WASTE_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'service_type',       label: 'Service Type',         required: true },
  { key: 'suburb',             label: 'Suburb / Area',        required: true },
  { key: 'month',              label: 'Month',                required: true },
  { key: 'financial_year',     label: 'Financial Year' },
  { key: 'tonnes',             label: 'Tonnes',               required: true },
  { key: 'collections',        label: 'Collections / Services', required: true },
  { key: 'contamination_rate', label: 'Contamination Rate (%)' },
  { key: 'cost',               label: 'Cost' },
];

export default function Step3WasteMapping({ data, onNext, onBack }: {
  data: MappingData; onNext: (d: MappingData) => void; onBack: () => void;
}) {
  const [form, setForm] = useState<MappingData>(data);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('serviceType', 'waste');
      const res = await fetch('/api/onboarding/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { setUploadError(json.error || 'Upload failed'); return; }
      setForm(f => ({ ...f, fileId: json.fileId, fileName: json.fileName, headers: json.headers, rows: json.rows, mappings: autoMap(json.headers) }));
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function autoMap(headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const lower = headers.map(h => h.toLowerCase());
    for (const f of WASTE_FIELDS) {
      const keywords: Record<string, string[]> = {
        service_type:       ['service type', 'service', 'type', 'stream'],
        suburb:             ['suburb', 'area', 'zone', 'locality', 'location'],
        month:              ['month', 'mth'],
        financial_year:     ['financial year', 'fin year', 'fy', 'year'],
        tonnes:             ['tonnes', 'tons', 'weight', 'kg'],
        collections:        ['collections', 'services', 'lifts', 'count'],
        contamination_rate: ['contamination', 'contam', 'reject'],
        cost:               ['cost', 'total cost', 'amount', '$'],
      };
      const kw = keywords[f.key] ?? [];
      const match = lower.findIndex(h => kw.some(k => h.includes(k)));
      if (match >= 0) map[f.key] = headers[match];
    }
    return map;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext(form);
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepShell
        icon="🗑️"
        title="Waste data mapping"
        subtitle="Upload your waste export and we'll help you map the columns. You can adjust them at any time."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Upload zone */}
          {!form.headers ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? 'rgba(124,58,237,.6)' : 'rgba(255,255,255,.12)'}`,
                borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
                background: dragging ? 'rgba(124,58,237,.06)' : 'rgba(255,255,255,.02)',
                transition: 'all .2s',
              }}
            >
              {uploading ? (
                <div style={{ color: '#A78BFA', fontSize: 14 }}>Parsing file…</div>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                  <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: '#F4F4F5' }}>
                    Drop your waste CSV or XLSX here
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: '#52525B' }}>
                    or <span style={{ color: '#A78BFA', textDecoration: 'underline' }}>click to browse</span>
                  </p>
                </>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)', borderRadius: 8 }}>
              <span style={{ fontSize: 13, color: '#22C55E' }}>✓ {form.fileName}</span>
              <button type="button" onClick={() => setForm(f => ({ ...f, fileId: undefined, fileName: undefined, headers: undefined, rows: undefined, mappings: {} }))}
                style={{ fontSize: 12, color: '#71717A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                Replace
              </button>
            </div>
          )}

          {uploadError && <p style={{ margin: 0, fontSize: 12, color: '#EF4444' }}>{uploadError}</p>}

          {/* Mapping table */}
          {form.headers && (
            <MappingTable
              fields={WASTE_FIELDS}
              headers={form.headers}
              mappings={form.mappings}
              onChange={mappings => setForm(f => ({ ...f, mappings }))}
            />
          )}

          {/* Data preview */}
          {form.headers && form.rows && form.rows.length > 0 && (
            <DataPreview headers={form.headers} rows={form.rows} />
          )}
        </div>

        <NavButtons onBack={onBack} next={form.headers ? 'Continue' : 'Skip for now'} />
      </StepShell>
    </form>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────

export function MappingTable({ fields, headers, mappings, onChange }: {
  fields: { key: string; label: string; required?: boolean }[];
  headers: string[];
  mappings: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  function set(field: string, col: string) {
    onChange({ ...mappings, [field]: col });
  }

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        Column Mapping
      </p>
      <div style={{ border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,.03)' }}>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: '#52525B', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', width: '45%' }}>
                System Field
              </th>
              <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: '#52525B', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' }}>
                Your Column
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.key} style={{ borderTop: '1px solid rgba(255,255,255,.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.01)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#D4D4D8' }}>
                  {f.label}
                  {f.required && <span style={{ fontSize: 10, color: '#A78BFA', marginLeft: 5, verticalAlign: 'middle' }}>required</span>}
                </td>
                <td style={{ padding: '8px 14px' }}>
                  <select
                    value={mappings[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6,
                      background: mappings[f.key] ? 'rgba(124,58,237,.1)' : 'rgba(255,255,255,.04)',
                      border: mappings[f.key] ? '1px solid rgba(124,58,237,.4)' : '1px solid rgba(255,255,255,.08)',
                      color: mappings[f.key] ? '#C4B5FD' : '#71717A',
                      fontSize: 13, fontFamily: FONT, cursor: 'pointer', outline: 'none',
                    }}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DataPreview({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        Data Preview (first {rows.length} rows)
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: FONT, minWidth: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,.03)' }}>
              {headers.map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: '#71717A', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ borderTop: '1px solid rgba(255,255,255,.04)' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding: '7px 12px', color: '#A1A1AA', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
