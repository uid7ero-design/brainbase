import { useState } from 'react';
import { buttonProps } from '@/components/ui/app';
import { buildBudgetSetupCsv, type BudgetSetupExportInput, type BudgetSetupExportKind } from '@/lib/commercial/budgetSetupExport';
import styles from './page.module.css';

export default function BudgetSetupExports({ input, busy }: { input: BudgetSetupExportInput; busy: boolean }) {
  const [error, setError] = useState('');
  function download(kind: BudgetSetupExportKind) {
    setError('');
    let url: string | undefined;
    try {
      const csv = buildBudgetSetupCsv(input, kind);
      url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `budget-v${input.version.version_number}-${kind}.csv`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    } catch { setError('Unable to export this saved Budget. Reload its records and try again.'); }
    finally { if (url) URL.revokeObjectURL(url); }
  }
  return <section aria-label="Budget setup exports">
    <p>Download the selected version’s loaded, saved records. Unsaved edits are excluded. Draft exports are planning records; they do not certify approval or show actual spending. Amounts use currency units with two decimal places.</p>
    <div className={styles.lineActions}>
      <button {...buttonProps('secondary')} type="button" disabled={busy || !input.version.lines.length} onClick={() => download('lines')}>Export Budget lines CSV</button>
      <button {...buttonProps('secondary')} type="button" disabled={busy || input.version.periodisation_mode !== 'PERIODISED' || !input.version.allocations.length} onClick={() => download('allocations')}>Export period allocations CSV</button>
      <button {...buttonProps('secondary')} type="button" disabled={busy || !input.version.mappings.length} onClick={() => download('mappings')}>Export commitment mappings CSV</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
