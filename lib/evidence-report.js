function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateReportHTML({ content, agentName, routeType, confidence, evidence, orgName, timestamp }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const confColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#ca8a04' : '#dc2626';
  const ts = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();

  const datasets = (evidence?.sourceDataset ?? []).map(d => `<span class="pill pill-cyan">${esc(d)}</span>`).join(' ');
  const columns  = (evidence?.sourceColumns  ?? []).map(c => `<span class="pill">${esc(c)}</span>`).join(' ');

  const sampleHeaders = evidence?.sampleRows?.length > 0 ? Object.keys(evidence.sampleRows[0]).slice(0, 7) : [];
  const sampleTable = sampleHeaders.length > 0 ? `
    <table>
      <thead><tr>${sampleHeaders.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${evidence.sampleRows.slice(0, 5).map(r =>
          `<tr>${sampleHeaders.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`
        ).join('')}
      </tbody>
    </table>` : '<p class="muted">No sample data available.</p>';

  const agentLabel = agentName?.replace(/([A-Z])/g, ' $1').trim() ?? 'Agent';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Evidence Report — ${esc(orgName ?? 'HLNA')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 40px; max-width: 860px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #0f0f23; margin-bottom: 4px; }
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6366f1; margin: 24px 0 8px; }
  h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 6px; }
  .meta-bar { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 28px; padding-bottom: 16px; border-bottom: 2px solid #f1f5f9; }
  .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .meta-card .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 3px; }
  .meta-card .value { font-size: 14px; font-weight: 700; color: #1e293b; }
  .conf-value { color: ${confColor}; }
  .response-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap; margin-bottom: 8px; }
  .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid #cbd5e1; background: #f8fafc; color: #475569; margin: 2px 2px 2px 0; }
  .pill-cyan { border-color: #7dd3fc; background: #f0f9ff; color: #0369a1; font-weight: 600; }
  .mono { font-family: 'Menlo', 'Cascadia Code', monospace; font-size: 11.5px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; color: #1d4ed8; line-height: 1.6; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11px; }
  th { text-align: left; padding: 5px 10px; background: #f1f5f9; border-bottom: 2px solid #e2e8f0; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:last-child td { border-bottom: none; }
  .muted { color: #94a3b8; font-style: italic; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 20px; }
    .meta-card { break-inside: avoid; }
  }
</style>
</head>
<body>

<h1>Evidence Report</h1>
<div style="font-size:12px;color:#64748b;margin-bottom:20px;">${esc(orgName ?? 'HLNA')} &middot; Generated ${esc(ts)}</div>

<div class="meta-bar">
  <div class="meta-card">
    <div class="label">Agent</div>
    <div class="value">${esc(agentLabel)}</div>
  </div>
  <div class="meta-card">
    <div class="label">Route Type</div>
    <div class="value">${esc(routeType ?? '—')}</div>
  </div>
  ${pct != null ? `<div class="meta-card">
    <div class="label">Confidence</div>
    <div class="value conf-value">${pct}%</div>
  </div>` : ''}
  <div class="meta-card">
    <div class="label">Datasets</div>
    <div class="value">${(evidence?.sourceDataset ?? []).length || '—'}</div>
  </div>
</div>

<h2>HLNA Response</h2>
<div class="response-box">${esc(content ?? '—')}</div>

<h2>Evidence Summary</h2>
<p style="font-size:13px;line-height:1.65;color:#334155;margin-bottom:12px;">${esc(evidence?.evidenceSummary ?? '—')}</p>

<h2>Source Data</h2>
<h3>Datasets</h3>
<div style="margin-bottom:10px;">${datasets || '<span class="muted">None</span>'}</div>
<h3>Columns Queried</h3>
<div style="margin-bottom:16px;">${columns || '<span class="muted">None</span>'}</div>

<h2>Calculation Used</h2>
<div class="mono">${esc(evidence?.calculationUsed ?? '—')}</div>

<h2>Confidence Reasoning</h2>
<p style="font-size:13px;line-height:1.65;color:#334155;">${esc(evidence?.confidenceReason ?? '—')}</p>

<h2>Sample Data</h2>
${sampleTable}

<div class="footer">
  <span>HLNA Evidence Report &middot; ${esc(orgName ?? '')}</span>
  <span>Printed ${esc(ts)}</span>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;
}
