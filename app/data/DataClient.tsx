'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/state/useAppStore';
import {
  Badge, Button, Dialog, Field, FormActions, PageHeader, StateMessage,
  TableContainer, TableStateRow, fieldControlClassName, tableStyles, type SemanticState,
} from '@/components/ui/app';
import styles from './Data.module.css';

type UploadedFile = {
  id: string;
  file_name: string;
  file_type: string;
  upload_status: 'processing' | 'complete' | 'error';
  created_at: string;
  uploaded_by_name: string;
  record_count: number;
};

type WasteRecord = {
  id: string;
  service_type: string | null;
  suburb: string | null;
  month: string | null;
  financial_year: string | null;
  tonnes: number | null;
  collections: number | null;
  contamination_rate: number | null;
  cost: number | null;
};

const REPORT_TYPES = [
  { value: 'waste_summary',  label: 'Waste Summary' },
  { value: 'contamination',  label: 'Contamination Analysis' },
  { value: 'cost_analysis',  label: 'Cost Analysis' },
  { value: 'diversion_rate', label: 'Diversion Rate' },
  { value: 'custom',         label: 'Custom' },
];

// Upload status → shared semantic state. The badge text stays the stored
// status value; the state only drives the token colour + dot shape.
const STATUS_STATE: Record<string, SemanticState> = {
  complete:   'success',
  processing: 'syncing',
  error:      'error',
};

export default function DataClient({ canDelete }: { canDelete: boolean }) {
  const router = useRouter();
  const setLastUpload = useAppStore(s => s.setLastUpload);
  const [files, setFiles]               = useState<UploadedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [records, setRecords]           = useState<WasteRecord[]>([]);
  const [uploading, setUploading]       = useState(false);
  const [uploadMsg, setUploadMsg]       = useState<{ text: string; ok: boolean } | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType]     = useState('waste_summary');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generating, setGenerating]     = useState(false);
  const [reportMsg, setReportMsg]       = useState<{ text: string; ok: boolean } | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    const res = await fetch('/api/files');
    if (res.status === 401) { setSessionExpired(true); return; }
    if (res.ok) {
      const data = await res.json();
      setFiles(data.files ?? []);
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      if (res.status === 401) { setSessionExpired(true); return; }
      const data = await res.json();
      if (res.ok) {
        setUploadMsg({ text: `Uploaded "${data.fileName}" — ${data.recordsInserted} records inserted.`, ok: true });
        setLastUpload(Date.now());
        await loadFiles();
      } else {
        setUploadMsg({ text: data.error ?? 'Upload failed.', ok: false });
      }
    } catch {
      setUploadMsg({ text: 'Network error during upload.', ok: false });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm('Delete this file and all its waste records?')) return;
    const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    if (res.ok) {
      if (selectedFile?.id === fileId) { setSelectedFile(null); setRecords([]); }
      await loadFiles();
    }
  }

  async function handleViewRecords(file: UploadedFile) {
    if (selectedFile?.id === file.id) { setSelectedFile(null); setRecords([]); return; }
    setSelectedFile(file);
    setRecords([]);
    setLoadingRecords(true);
    const res = await fetch(`/api/files/${file.id}`);
    if (res.ok) {
      const data = await res.json();
      setRecords(data.records ?? []);
    }
    setLoadingRecords(false);
  }

  async function handleGenerateReport() {
    setGenerating(true);
    setReportMsg(null);
    const body: Record<string, string> = { reportType };
    if (selectedFile) body.sourceFileId = selectedFile.id;
    if (reportType === 'custom' && customPrompt) body.customPrompt = customPrompt;
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setReportMsg({ text: `Report "${data.report.report_title}" generated.`, ok: true });
        setTimeout(() => setShowReportModal(false), 1500);
      } else {
        setReportMsg({ text: data.error ?? 'Generation failed.', ok: false });
      }
    } catch {
      setReportMsg({ text: 'Network error.', ok: false });
    } finally {
      setGenerating(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }

  if (sessionExpired) {
    return (
      <div className={`${styles.page} ${styles.expired}`}>
        <div className={styles.expiredCard}>
          <h1 className={styles.expiredTitle}>Session expired</h1>
          <p className={styles.expiredBody}>
            Your session is no longer valid. Log out and back in to continue.
          </p>
          <Button
            variant="primary"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              router.push('/login');
            }}
          >
            Log out and back in
          </Button>
        </div>
      </div>
    );
  }

  const noCompleteFiles = files.filter(f => f.upload_status === 'complete').length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* Header */}
        <PageHeader
          title="Data"
          description="Upload spreadsheets, view waste records, generate reports"
          actions={
            <Button
              variant="primary"
              onClick={() => setShowReportModal(true)}
              disabled={noCompleteFiles}
            >
              Generate Report
            </Button>
          }
        />

        {/* Upload zone — a real button so it is keyboard operable; the same
            drag handlers and the same hidden file input as before. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
        />
        <button
          type="button"
          className={styles.dropzone}
          data-dragging={dragging ? 'true' : undefined}
          aria-busy={uploading || undefined}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <span className={styles.dropPrimary}>Uploading…</span>
          ) : (
            <>
              <span className={styles.dropPrimary}>
                {dragging ? 'Drop to upload' : 'Drag & drop or click to upload'}
              </span>
              <span className={styles.dropSecondary}>.xlsx, .xls, .csv</span>
            </>
          )}
        </button>

        {uploadMsg && (
          <div
            className={styles.message}
            data-ok={uploadMsg.ok ? 'true' : 'false'}
            data-spaced="true"
            role={uploadMsg.ok ? 'status' : 'alert'}
          >
            <span className={styles.messageText}>
              <span className={styles.messageMark} aria-hidden="true">{uploadMsg.ok ? '✓' : '!'}</span>
              <span>{uploadMsg.text}</span>
            </span>
            <button type="button" className={styles.dismiss} onClick={() => setUploadMsg(null)} aria-label="Dismiss message">×</button>
          </div>
        )}

        {/* Files table */}
        <TableContainer label="Uploaded files" minWidth={720} className={styles.filesTable}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                {['File', 'Type', 'Records', 'Status', 'Uploaded by', 'Date', ''].map(h => (
                  <th key={h} scope="col" className={h === 'Records' ? tableStyles.num : h === '' ? tableStyles.actions : undefined}>
                    {h === '' ? <span className={styles.srOnly}>Actions</span> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.length === 0 && (
                <TableStateRow colSpan={7} kind="empty">
                  No files uploaded yet. Upload a spreadsheet above.
                </TableStateRow>
              )}
              {files.map(f => {
                const selected = selectedFile?.id === f.id;
                return (
                  <tr key={f.id} aria-selected={selected ? true : undefined}>
                    <td className={`${tableStyles.primary} ${styles.fileName}`}>{f.file_name}</td>
                    <td className={styles.fileType}>{f.file_type}</td>
                    <td className={tableStyles.num}>{f.record_count.toLocaleString()}</td>
                    <td>
                      <Badge state={STATUS_STATE[f.upload_status] ?? 'inactive'}>
                        {f.upload_status}
                      </Badge>
                    </td>
                    <td>{f.uploaded_by_name}</td>
                    <td>{new Date(f.created_at).toLocaleDateString()}</td>
                    <td className={tableStyles.actions}>
                      <span className={styles.rowActions}>
                        {f.upload_status === 'complete' && (
                          <Button
                            size="sm"
                            variant={selected ? 'primary' : 'secondary'}
                            aria-expanded={selected}
                            aria-label={`${selected ? 'Hide' : 'View'} records for ${f.file_name}`}
                            onClick={() => handleViewRecords(f)}
                          >
                            {selected ? 'Hide' : 'View'}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`Delete ${f.file_name}`}
                            onClick={() => handleDelete(f.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableContainer>

        {/* Records panel */}
        {selectedFile && (
          <div>
            <div className={styles.recordsHeader}>
              <h2 className={styles.recordsTitle}>
                Records — <span className={styles.recordsFile}>{selectedFile.file_name}</span>
              </h2>
              <span className={styles.recordsCount}>{records.length.toLocaleString()} rows</span>
            </div>
            {loadingRecords ? (
              <StateMessage kind="loading" size="page" title="Loading records…" />
            ) : (
              <TableContainer label={`Records — ${selectedFile.file_name}`} minWidth={760} className={styles.recordsScroll}>
                <table className={`${tableStyles.table} ${styles.recordsTable}`}>
                  <thead>
                    <tr>
                      {['Service Type', 'Suburb', 'Month', 'Fin. Year', 'Tonnes', 'Collections', 'Contam. %', 'Cost'].map((h, hi) => (
                        <th key={h} scope="col" className={hi >= 4 ? tableStyles.num : undefined}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id}>
                        <td>{r.service_type ?? '—'}</td>
                        <td>{r.suburb ?? '—'}</td>
                        <td>{r.month ?? '—'}</td>
                        <td>{r.financial_year ?? '—'}</td>
                        <td className={tableStyles.num}>{r.tonnes != null ? r.tonnes.toLocaleString() : '—'}</td>
                        <td className={tableStyles.num}>{r.collections != null ? r.collections.toLocaleString() : '—'}</td>
                        <td className={tableStyles.num}>{r.contamination_rate != null ? `${r.contamination_rate}%` : '—'}</td>
                        <td className={tableStyles.num}>{r.cost != null ? `$${Number(r.cost).toLocaleString()}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            )}
          </div>
        )}
      </div>

      {/* Report dialog */}
      <Dialog open={showReportModal} onClose={() => setShowReportModal(false)} title="Generate Report" width={460}>
        <div className={styles.dialogForm}>
          <Field label="Report Type">
            {control => (
              <select {...control} className={fieldControlClassName} value={reportType} onChange={e => setReportType(e.target.value)}>
                {REPORT_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            )}
          </Field>

          <Field label={<>Source File <span className={styles.labelHint}>(optional — uses all data if blank)</span></>}>
            {control => (
              <select
                {...control}
                className={fieldControlClassName}
                value={selectedFile?.id ?? ''}
                onChange={e => {
                  const f = files.find(f => f.id === e.target.value) ?? null;
                  setSelectedFile(f);
                }}
              >
                <option value="">All uploaded data</option>
                {files.filter(f => f.upload_status === 'complete').map(f => (
                  <option key={f.id} value={f.id}>{f.file_name}</option>
                ))}
              </select>
            )}
          </Field>

          {reportType === 'custom' && (
            <Field label="Custom Prompt">
              {control => (
                <textarea
                  {...control}
                  className={`${fieldControlClassName} ${styles.textarea}`}
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="Describe what you want the report to cover…"
                  rows={3}
                />
              )}
            </Field>
          )}

          {reportMsg && (
            <div className={styles.message} data-ok={reportMsg.ok ? 'true' : 'false'} role={reportMsg.ok ? 'status' : 'alert'}>
              <span className={styles.messageText}>
                <span className={styles.messageMark} aria-hidden="true">{reportMsg.ok ? '✓' : '!'}</span>
                <span>{reportMsg.text}</span>
              </span>
            </div>
          )}

          <FormActions align="stretch">
            <Button
              variant="primary"
              onClick={handleGenerateReport}
              disabled={generating}
            >
              {generating ? 'Generating…' : 'Generate with HLNA'}
            </Button>
          </FormActions>
        </div>
      </Dialog>
    </div>
  );
}
