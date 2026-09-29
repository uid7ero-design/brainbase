'use client';

import { useState, useRef } from 'react';
import { MappingData } from '../OnboardingWizard';
import { StepShell, NavButtons } from './Step1OrgInfo';
import { MappingTable, DataPreview } from './Step3WasteMapping';
import { Button, FormError } from '@/components/ui/app';
import styles from '../Onboarding.module.css';

const FLEET_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'vehicle_id',    label: 'Vehicle ID',      required: true },
  { key: 'vehicle_type',  label: 'Vehicle Type' },
  { key: 'make',          label: 'Make / Model' },
  { key: 'year',          label: 'Year' },
  { key: 'department',    label: 'Department' },
  { key: 'driver',        label: 'Driver' },
  { key: 'month',         label: 'Month',           required: true },
  { key: 'financial_year',label: 'Financial Year' },
  { key: 'km',            label: 'Kilometres',      required: true },
  { key: 'fuel',          label: 'Fuel Cost',       required: true },
  { key: 'wages',         label: 'Wages' },
  { key: 'maintenance',   label: 'Maintenance' },
  { key: 'rego',          label: 'Registration' },
  { key: 'repairs',       label: 'Repairs' },
  { key: 'insurance',     label: 'Insurance' },
  { key: 'depreciation',  label: 'Depreciation' },
  { key: 'services',      label: 'Service Count' },
  { key: 'defects',       label: 'Defect Count' },
];

export default function Step4FleetMapping({ data, onNext, onBack }: {
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
      fd.append('serviceType', 'fleet');
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
    const keywords: Record<string, string[]> = {
      vehicle_id:     ['vehicle id', 'vehicle', 'rego', 'reg', 'fleet no', 'fleet number', 'unit'],
      vehicle_type:   ['vehicle type', 'type', 'class'],
      make:           ['make', 'model', 'make/model'],
      year:           ['year', 'manufacture year'],
      department:     ['department', 'dept', 'section', 'division'],
      driver:         ['driver', 'operator'],
      month:          ['month', 'mth'],
      financial_year: ['financial year', 'fin year', 'fy', 'year'],
      km:             ['km', 'kilometres', 'kilometers', 'odometer', 'distance'],
      fuel:           ['fuel', 'fuel cost', 'petrol', 'diesel'],
      wages:          ['wages', 'labour', 'labor', 'salary'],
      maintenance:    ['maintenance', 'servicing'],
      rego:           ['registration', 'rego cost', 'license'],
      repairs:        ['repairs', 'repair cost'],
      insurance:      ['insurance'],
      depreciation:   ['depreciation', 'depr'],
      services:       ['services', 'service count', 'no services'],
      defects:        ['defects', 'defect count', 'no defects'],
    };
    for (const [field, kw] of Object.entries(keywords)) {
      const match = lower.findIndex(h => kw.some(k => h.includes(k)));
      if (match >= 0) map[field] = headers[match];
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
        icon="🚛"
        title="Fleet data mapping"
        subtitle="Upload your fleet export and map the columns. Fields like KM, fuel and maintenance power the cost and efficiency dashboards."
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
                      Drop your fleet CSV or XLSX here
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

          {form.headers && (
            <MappingTable
              fields={FLEET_FIELDS}
              headers={form.headers}
              mappings={form.mappings}
              onChange={mappings => setForm(f => ({ ...f, mappings }))}
            />
          )}

          {form.headers && form.rows && form.rows.length > 0 && (
            <DataPreview headers={form.headers} rows={form.rows} />
          )}
        </div>

        <NavButtons onBack={onBack} next={form.headers ? 'Continue' : 'Skip for now'} />
      </StepShell>
    </form>
  );
}
