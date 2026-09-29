'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, PageHeader } from '@/components/ui/app';
import styles from './ReportView.module.css';

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
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* Back + title + actions (application chrome) */}
        <PageHeader
          eyebrow={<Link href="/reports" className={styles.back}>← Reports</Link>}
          title={title}
          meta={<span className={styles.typeTag}>{TYPE_LABELS[reportType] ?? reportType}</span>}
          description={
            <span className={styles.metaRow}>
              <span>{organisationName}</span>
              <span aria-hidden="true">·</span>
              <span>Generated by {createdByName}</span>
              <span aria-hidden="true">·</span>
              <span>{new Date(createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              {sourceFileName && <><span aria-hidden="true">·</span><span className={styles.source}>{sourceFileName}</span></>}
            </span>
          }
          actions={
            <div className={styles.actions}>
              <Button variant="secondary" onClick={handlePdfExport} disabled={exportingPdf}>
                {exportingPdf ? 'Exporting…' : 'Download PDF'}
              </Button>
              {canDelete && (
                <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              )}
            </div>
          }
        />

        {/* Report content — generated text, rendered unchanged; only the
            reading surface's colours come from ReportView.module.css. */}
        <article
          aria-label={title}
          className={`report-content ${styles.content}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    </div>
  );
}
