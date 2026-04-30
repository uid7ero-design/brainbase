'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/state/useAppStore';

const BG    = '#07080B';
const CARD  = '#0e1014';
const BORDER = '#1a1d24';
const FONT  = 'var(--font-inter), Inter, sans-serif';

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

const STATUS_COLORS: Record<string, string> = {
  complete:   '#34d399',
  processing: '#fbbf24',
  error:      '#f87171',
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
      <div style={{ background: BG, minHeight: 'calc(100vh - 52px)', fontFamily: FONT, color: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Session expired</h2>
          <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
            Your session is no longer valid. Log out and back in to continue.
          </p>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              router.push('/login');
            }}
            style={{ padding: '10px 24px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Log out and back in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: BG, minHeight: 'calc(100vh - 52px)', fontFamily: FONT, color: '#f9fafb', padding: '40px 40px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Data</h1>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4, marginBottom: 0 }}>Upload spreadsheets, view waste records, generate reports</p>
          </div>
          <button
            onClick={() => setShowReportModal(true)}
            disabled={files.filter(f => f.upload_status === 'complete').length === 0}
            style={btnStyle('#7c3aed', files.filter(f => f.upload_status === 'complete').length === 0)}
          >
            Generate Report
          </button>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? '#7c3aed' : BORDER}`,
            borderRadius: 12,
            padding: '36px 24px',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            marginBottom: 28,
            background: dragging ? 'rgba(124,58,237,0.05)' : 'transparent',
            transition: 'border-color .15s, background .15s',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
          />
          {uploading ? (
            <p style={{ color: '#9ca3af', margin: 0, fontSize: 14 }}>Uploading…</p>
          ) : (
            <>
              <p style={{ color: '#9ca3af', fontSize: 14, margin: '0 0 4px' }}>
                {dragging ? 'Drop to upload' : 'Drag & drop or click to upload'}
              </p>
              <p style={{ color: '#4b5563', fontSize: 12, margin: 0 }}>.xlsx, .xls, .csv</p>
            </>
          )}
        </div>

        {uploadMsg && (
          <div style={{ ...msgBox(uploadMsg.ok), marginBottom: 20 }}>
            {uploadMsg.text}
            <button onClick={() => setUploadMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 10, opacity: 0.6 }}>×</button>
          </div>
        )}

        {/* Files table */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginBottom: 32 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['File', 'Type', 'Records', 'Status', 'Uploaded by', 'Date', ''].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 }}>
                    No files uploaded yet. Upload a spreadsheet above.
                  </td>
                </tr>
              )}
              {files.map((f, i) => (
                <tr
                  key={f.id}
                  style={{
                    borderBottom: i < files.length - 1 ? `1px solid ${BORDER}` : 'none',
                    background: selectedFile?.id === f.id ? 'rgba(124,58,237,0.07)' : 'transparent',
                    transition: 'background .1s',
                  }}
                >
                  <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.file_type}</td>
                  <td style={{ padding: '13px 16px', fontSize: 13, color: '#9ca3af' }}>{f.record_count.toLocaleString()}</td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[f.upload_status] ?? '#9ca3af', background: `${STATUS_COLORS[f.upload_status]}18`, padding: '3px 8px', borderRadius: 4 }}>
                      {f.upload_status}
                    </span>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: 13, color: '#6b7280' }}>{f.uploaded_by_name}</td>
                  <td style={{ padding: '13px 16px', fontSize: 12, color: '#4b5563' }}>{new Date(f.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {f.upload_status === 'complete' && (
                        <button
                          onClick={() => handleViewRecords(f)}
                          style={smallBtn(selectedFile?.id === f.id ? '#7c3aed' : '#1f2937', selectedFile?.id === f.id ? '#fff' : '#d1d5db')}
                        >
                          {selectedFile?.id === f.id ? 'Hide' : 'View'}
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(f.id)} style={smallBtn('rgba(239,68,68,0.1)', '#f87171')}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Records panel */}
        {selectedFile && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                Records — <span style={{ color: '#9ca3af', fontWeight: 400 }}>{selectedFile.file_name}</span>
              </h2>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{records.length.toLocaleString()} rows</span>
            </div>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'auto', maxHeight: 420 }}>
              {loadingRecords ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#4b5563', fontSize: 14 }}>Loading records…</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: CARD, zIndex: 1 }}>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Service Type', 'Suburb', 'Month', 'Fin. Year', 'Tonnes', 'Collections', 'Contam. %', 'Cost'].map(h => (
                        <th key={h} style={{ ...thStyle, fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: i < records.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                        <td style={tdStyle}>{r.service_type ?? '—'}</td>
                        <td style={tdStyle}>{r.suburb ?? '—'}</td>
                        <td style={tdStyle}>{r.month ?? '—'}</td>
                        <td style={tdStyle}>{r.financial_year ?? '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.tonnes != null ? r.tonnes.toLocaleString() : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.collections != null ? r.collections.toLocaleString() : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.contamination_rate != null ? `${r.contamination_rate}%` : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.cost != null ? `$${Number(r.cost).toLocaleString()}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 }}>
          <div style={{ background: '#0e1014', border: `1px solid ${BORDER}`, borderRadius: 14, padding: 28, width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Generate Report</h2>
              <button onClick={() => setShowReportModal(false)} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>Report Type</label>
                <select value={reportType} onChange={e => setReportType(e.target.value)} style={selectStyle}>
                  {REPORT_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Source File <span style={{ color: '#4b5563', fontWeight: 400, textTransform: 'none' }}>(optional — uses all data if blank)</span></label>
                <select
                  value={selectedFile?.id ?? ''}
                  onChange={e => {
                    const f = files.find(f => f.id === e.target.value) ?? null;
                    setSelectedFile(f);
                  }}
                  style={selectStyle}
                >
                  <option value="">All uploaded data</option>
                  {files.filter(f => f.upload_status === 'complete').map(f => (
                    <option key={f.id} value={f.id}>{f.file_name}</option>
                  ))}
                </select>
              </div>

              {reportType === 'custom' && (
                <div>
                  <label style={labelStyle}>Custom Prompt</label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="Describe what you want the report to cover…"
                    rows={3}
                    style={{ ...selectStyle, resize: 'vertical', lineHeight: 1.5 }}
                  />
                </div>
              )}

              {reportMsg && <div style={msgBox(reportMsg.ok)}>{reportMsg.text}</div>}

              <button
                onClick={handleGenerateReport}
                disabled={generating}
                style={btnStyle('#7c3aed', generating)}
              >
                {generating ? 'Generating…' : 'Generate with HLNA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '10px 16px', color: '#9ca3af', whiteSpace: 'nowrap' };
const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const selectStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, fontFamily: 'var(--font-inter), Inter, sans-serif' };
function msgBox(ok: boolean): React.CSSProperties {
  return { fontSize: 13, padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: ok ? '#34d399' : '#f87171', background: ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` };
}
function btnStyle(bg: string, disabled: boolean): React.CSSProperties {
  return { padding: '10px 20px', background: disabled ? '#1a1d24' : bg, color: disabled ? '#4b5563' : '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' };
}
function smallBtn(bg: string, color: string): React.CSSProperties {
  return { padding: '5px 10px', background: bg, color, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' };
}
