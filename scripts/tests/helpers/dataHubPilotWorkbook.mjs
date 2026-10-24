import XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

// Synthetic source conventions only. Never an approved real pilot mapping.
export function createPilotWorkbook() {
  const manifest = JSON.parse(readFileSync(new URL('../../../config/data-hub/onkaparinga-monthly-operations-v1.json', import.meta.url), 'utf8'));
  const workbook = XLSX.utils.book_new();
  for (const sheet of manifest.worksheets) {
    const rows = [['SYNTHETIC ACCEPTANCE FIXTURE - NOT CUSTOMER DATA'], [], sheet.columns.map(c => c.header)];
    if (sheet.logicalKey === 'runs') rows.push(
      ['0001', '2026-10-01', '007', 'TRUCK-A', 'Synthetic collection', 'Synthetic driver A', 0, 2, null, null, 0, 1.25, 8, 10, 0.5, 1.5, 2, 0.5, 10, 12, 22],
      ['0002', '2026-10-02', '008', 'TRUCK-B', 'Synthetic collection', 'Synthetic driver B', 1, 3, 0, null, 0, 0, 0, 12, 0, 2, 3, 1, 8, 11, 19]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet.name);
  }
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}
