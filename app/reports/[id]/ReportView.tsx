'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const BG     = '#07080B';
const CARD   = '#0e1014';
const BORDER = '#1a1d24';
const FONT   = 'var(--font-inter), Inter, sans-serif';

const TYPE_LABELS: Record<string, string> = {
  waste_summary:  'Waste Summary',
  contamination:  'Contamination Analysis',
  cost_analysis:  'Cost Analysis',
  diversion_rate: 'Diversion Rate',
  custom:         'Custom',
};

type Props = {
  id: string;
  title: string;
  reportType: string;
  content: string;
  createdByName: string;
  organisationName: string;
  sourceFileName: string | null;
  createdAt: string;
  canDelete: boolean;
};

// Minimal markdown → HTML for AI-generated report content
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // fenced code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // horizontal rule
    .replace(/^---$/gm, '<hr />')
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bullet lists — group consecutive lines
    .replace(/((?:^- .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    })
    // numbered lists
    .replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    })
    // paragraphs
    .split(/\n{2,}/)
    .map(chunk => {
      const t = chunk.trim();
      if (!t) return '';
      if (/^<(h[1-4]|ul|ol|pre|hr)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

export default function ReportView({ id, title, reportType, content, createdByName, organisationName, sourceFileName, createdAt, canDelete }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  async function handleDelete() {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    setDeleting(true);
    const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/reports');
    else setDeleting(false);
  }

  async function handlePdfExport() {
    setExportingPdf(true);
    try {
      const [jspdfMod, res] = await Promise.all([
        import('jspdf'),
        fetch(`/api/reports/${id}?format=pdf`),
      ]);
      const { pdf } = await res.json();
      const JsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

      const doc = new JsPDF({ unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 18;
      const usable = pageW - margin * 2;
      let y = margin;

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      const titleLines = doc.splitTextToSize(pdf.title, usable);
      doc.text(titleLines, margin, y);
      y += titleLines.length * 8 + 4;

      // Metadata
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`${pdf.organisationName} · ${TYPE_LABELS[pdf.reportType] ?? pdf.reportType} · ${new Date(pdf.createdAt).toLocaleDateString('en-AU')} · ${pdf.createdBy}`, margin, y);
      if (pdf.sourceFile) { y += 5; doc.text(`Source: ${pdf.sourceFile}`, margin, y); }
      y += 10;

      // Divider
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      // Content — strip markdown syntax for clean PDF text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);

      const plainLines = pdf.content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^#{1,4} /gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/^- /gm, '• ')
        .replace(/^\d+\. /gm, '')
        .replace(/^---$/gm, '')
        .split('\n');

      for (const line of plainLines) {
        const wrapped = doc.splitTextToSize(line || ' ', usable);
        if (y + wrapped.length * 5.5 > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(wrapped, margin, y);
        y += wrapped.length * 5.5 + (line.trim() === '' ? 2 : 0);
      }

      doc.save(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    } catch (e) {
      console.error('[pdf]', e);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div style={{ background: BG, minHeight: 'calc(100vh - 52px)', fontFamily: FONT, color: '#f9fafb', padding: '40px 40px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>

        {/* Back + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <Link href="/reports" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Reports</Link>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handlePdfExport} disabled={exportingPdf} style={btn('#1f2937')}>
              {exportingPdf ? 'Exporting…' : 'Download PDF'}
            </button>
            {canDelete && (
              <button onClick={handleDelete} disabled={deleting} style={btn('rgba(239,68,68,0.15)', '#f87171')}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        {/* Header card */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', background: 'rgba(167,139,250,0.1)', padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {TYPE_LABELS[reportType] ?? reportType}
            </span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 14px', lineHeight: 1.3 }}>{title}</h1>
          <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#6b7280', flexWrap: 'wrap' }}>
            <span>{organisationName}</span>
            <span>·</span>
            <span>Generated by {createdByName}</span>
            <span>·</span>
            <span>{new Date(createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            {sourceFileName && <><span>·</span><span style={{ color: '#4b5563' }}>{sourceFileName}</span></>}
          </div>
        </div>

        {/* Report content */}
        <div
          className="report-content"
          style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '32px 36px' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />

        <style>{`
          .report-content h1,.report-content h2,.report-content h3,.report-content h4{color:#f9fafb;font-weight:600;margin:1.5em 0 0.5em;letter-spacing:-0.01em}
          .report-content h2{font-size:1.15em}
          .report-content h3{font-size:1em;color:#d1d5db}
          .report-content p{color:#d1d5db;line-height:1.75;margin:0.75em 0}
          .report-content ul,.report-content ol{color:#d1d5db;padding-left:1.4em;margin:0.75em 0;line-height:1.75}
          .report-content li{margin:0.25em 0}
          .report-content strong{color:#f9fafb;font-weight:600}
          .report-content code{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;font-size:0.875em;font-family:monospace}
          .report-content pre{background:#111318;border:1px solid #1a1d24;border-radius:8px;padding:16px;overflow:auto;margin:1em 0}
          .report-content pre code{background:none;border:none;padding:0;font-size:0.85em}
          .report-content hr{border:none;border-top:1px solid #1a1d24;margin:1.5em 0}
        `}</style>
      </div>
    </div>
  );
}

function btn(bg: string, color = '#d1d5db'): React.CSSProperties {
  return { padding: '8px 16px', background: bg, color, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT };
}
