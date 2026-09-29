'use client';

import { useState, useRef } from 'react';
import { MappingData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';
import { Button, FormError, TableContainer, fieldControlClassName, tableStyles } from '@/components/ui/app';
import styles from '../Onboarding.module.css';

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
        <div className={styles.stackLoose}>
          {/* Upload zone */}
          {!form.headers ? (
            <>
              <button
                type="button"
                className={styles.dropzone}
                data-dragging={dragging ? 'true' : undefined}
                aria-busy={uploading || undefined}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <span className={styles.dropzoneBusy}>Parsing file…</span>
                ) : (
                  <>
                    <span className={styles.dropzoneTitle}>
                      Drop your waste CSV or XLSX here
                    </span>
                    <span className={styles.dropzoneHint}>
                      or <span className={styles.dropzoneLink}>click to browse</span>
                    </span>
                  </>
                )}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
            </>
          ) : (
            <div className={styles.fileRow}>
              <span className={styles.fileName}>
                <span className={styles.fileTick} aria-hidden="true">✓</span>
                <span><span className="bb-visually-hidden">Uploaded: </span>{form.fileName}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, fileId: undefined, fileName: undefined, headers: undefined, rows: undefined, mappings: {} }))}>
                Replace
              </Button>
            </div>
          )}

          {uploadError && <FormError>{uploadError}</FormError>}

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
      <h3 className={styles.groupTitle}>Column Mapping</h3>
      <TableContainer label="Column mapping" minWidth={360}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.fieldCol}>System Field</th>
              <th scope="col">Your Column</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <tr key={f.key}>
                <td className={tableStyles.primary}>
                  {f.label}
                  {f.required && <span className={styles.requiredTag}>required</span>}
                </td>
                <td>
                  <select
                    aria-label={f.label}
                    className={`${fieldControlClassName} ${styles.mapSelect}`}
                    data-mapped={mappings[f.key] ? 'true' : undefined}
                    value={mappings[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                  >
                    <option value="">— Not mapped —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}

export function DataPreview({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div>
      <h3 className={styles.groupTitle}>
        Data Preview (first {rows.length} rows)
      </h3>
      <TableContainer label="Data preview" minWidth={0}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className={styles.previewCell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
