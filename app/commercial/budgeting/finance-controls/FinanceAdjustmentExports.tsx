'use client';
import { useState } from 'react';
import { buttonProps } from '@/components/ui/app';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { buildAdjustmentExport, type AdjustmentExportInput, type AdjustmentExportKind } from '@/lib/commercial/financeAdjustmentExport';

const detailExports: Array<[AdjustmentExportKind, string]> = [
  ['report', 'Download readable evidence report'],
  ['summary', 'Export adjustment summary CSV'], ['lines', 'Export adjustment lines CSV'],
  ['lifecycle', 'Export lifecycle history CSV'], ['record', 'Download complete evidence JSON'],
];
export function FinanceAdjustmentExports({ input }: { input: Omit<AdjustmentExportInput, 'exportedAt'> }) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function download(kind: AdjustmentExportKind) {
    setError('');setNotice('');
    try {
      const file = buildAdjustmentExport({ ...input, exportedAt: new Date().toISOString() }, kind);
      setNotice(requestFinanceEvidenceDownload(file));
    } catch { setError('Unable to download this saved evidence. Reload the adjustment register and select the adjustment again.'); }
  }
  return <details style={{ marginBlock: 14 }}>
    <summary>Download saved adjustment records</summary>
    <section aria-label="Finance adjustment exports" style={{ paddingBlock: 10 }}>
    <h3 style={{ fontSize: 14 }}>Displayed register page</h3>
    <p style={{ fontSize: 12 }}>Type: {input.scope.adjustmentType ? input.scope.adjustmentType.replaceAll('_', ' ') : 'All adjustment types'} · Applied search: {input.scope.search || 'None'}.</p>
    <p style={{ fontSize: 12 }}>Page {input.report.page} · {input.report.adjustments.length} displayed of {input.report.totalCount} matching adjustments · {input.scope.currency} · {input.scope.status || 'All statuses'}. Register loaded {formatAustralianTimestamp(input.registerReadAt)}.</p>
    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Register exports contain this displayed page only. Detail exports contain the selected adjustment’s loaded saved evidence. Amounts include exact cents and currency units with two decimal places, stored as text to preserve precision in spreadsheets. Unresolved Budget amounts stay blank and are labelled unresolved.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button {...buttonProps('secondary', 'sm')} type="button" disabled={!input.report.adjustments.length} onClick={() => download('register')}>Export displayed adjustment page CSV</button>
      <button {...buttonProps('secondary', 'sm')} type="button" disabled={!input.report.adjustments.length} onClick={() => download('register-record')}>Download displayed adjustment page JSON</button>
    </div>
    <h3 style={{ fontSize: 14 }}>Selected adjustment</h3>
    {input.evidence && input.evidenceReadAt ? <p style={{ fontSize: 12 }}>Adjustment {input.evidence.adjustment.number} · {input.evidence.adjustment.status} · {input.evidence.adjustment.periodName}. Detail loaded {formatAustralianTimestamp(input.evidenceReadAt)}.</p> : <p style={{ fontSize: 12 }}>Review an adjustment to enable its detail downloads.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {detailExports.map(([kind, label]) => <button key={kind} {...buttonProps('secondary', 'sm')} type="button" disabled={!input.evidence || !input.evidenceReadAt || (kind === 'lines' && !input.evidence.lines.length)} onClick={() => download(kind)}>{label}</button>)}
    </div>
    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>The readable report opens as a downloaded web page. Open the file and use your browser’s Print command to print or save a PDF.</p>
    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loaded times record when this screen received the records; download time is recorded separately. Exports do not certify approval, change Budget Actual or combine an original adjustment with its reversal. JSON preserves original values and is not a restore file.</p>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    </section>
  </details>;
}
