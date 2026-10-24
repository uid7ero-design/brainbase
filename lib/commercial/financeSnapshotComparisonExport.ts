import { buildCsv,type CsvCell } from '@/lib/events/csvExport';
import { isFinanceAuditTimestamp } from './financeSetupDisplay';
import { RECONCILIATION_AMOUNT_FIELDS } from './financeReconciliationEvidenceModel';
import { compareFinanceSnapshotTotals,type FinanceSnapshotComparison } from './financeSnapshotComparison';
import { buildSnapshotComparisonHtml } from './financeSnapshotComparisonReport';
export type SnapshotComparisonDownloadKind='csv'|'header-csv'|'json'|'report';
export function buildSnapshotComparisonDownload(comparison:FinanceSnapshotComparison,exportedAt:string,kind:SnapshotComparisonDownloadKind){
  if(!['csv','header-csv','json','report'].includes(kind)||!isFinanceAuditTimestamp(exportedAt))throw new Error('Comparison export metadata is unavailable.');
  const saved=compareFinanceSnapshotTotals(comparison.scope,comparison.baseline,comparison.comparison);
  const filenameId=(value:string)=>value.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
  const filename=`reconciliation-comparison-${filenameId(saved.baseline.header.id)}-to-${filenameId(saved.comparison.header.id)}`;
  if(kind==='report')return {filename:`${filename}.html`,type:'text/html;charset=utf-8',content:buildSnapshotComparisonHtml(saved,exportedAt)};
  if(kind==='json')return {filename:`${filename}.json`,type:'application/json;charset=utf-8',content:JSON.stringify({
    format:'brainbase-reconciliation-total-comparison',version:1,exportedAt,
    purpose:'Comparison header totals minus chosen baseline header totals, with saved header-field differences. Two headers were read independently. No item-level or lifecycle-event differences are inferred. Not a new accounting fact, sign-off or restore file.',comparison:saved,
  },null,2)};
  const protect=(cell:CsvCell):CsvCell=>typeof cell==='string'&&(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)||/^\d+(?:\.\d+)?$/.test(cell))?`'${cell}`:cell;
  if(kind==='header-csv')return {filename:`${filename}-saved-header-fields.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    'Year ID','Period ID','Source','Currency','Baseline ID','Baseline read at ISO','Comparison ID','Comparison read at ISO','Exported at ISO','Field','Baseline value state','Baseline value','Comparison value state','Comparison value','Difference',
  ],saved.headerDifferences.map(row=>[saved.scope.yearId,saved.scope.periodId,saved.scope.source,saved.scope.currency,saved.baseline.header.id,saved.baseline.readAt,saved.comparison.header.id,saved.comparison.readAt,exportedAt,row.label,
    row.baseline===null?'NOT_RECORDED':row.baseline===''?'EMPTY_TEXT':'RECORDED',row.baseline===null?null:String(row.baseline),row.comparison===null?'NOT_RECORDED':row.comparison===''?'EMPTY_TEXT':'RECORDED',row.comparison===null?null:String(row.comparison),row.changed?'Different':'Same'].map(protect)))};
  const decimal=(cents:string)=>{const value=BigInt(cents),absolute=value<BigInt(0)?-value:value;return `${value<BigInt(0)?'-':''}${absolute/BigInt(100)}.${(absolute%BigInt(100)).toString().padStart(2,'0')}`;};
  const labels=['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'];
  return {filename:`${filename}.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    'Year ID','Period ID','Source','Currency','Baseline ID','Baseline status','Baseline snapshot at ISO','Baseline prepared at ISO','Baseline read at ISO','Comparison ID','Comparison status','Comparison snapshot at ISO','Comparison prepared at ISO','Comparison read at ISO','Exported at ISO','Direction','Measure','Baseline cents','Baseline amount','Comparison cents','Comparison amount','Change cents','Change amount','Baseline unresolved items','Comparison unresolved items','Unresolved item count change',
  ],RECONCILIATION_AMOUNT_FIELDS.map((field,index)=>[saved.scope.yearId,saved.scope.periodId,saved.scope.source,saved.scope.currency,
    saved.baseline.header.id,saved.baseline.header.status,saved.baseline.header.snapshotAt,saved.baseline.header.preparedAt,saved.baseline.readAt,saved.comparison.header.id,saved.comparison.header.status,saved.comparison.header.snapshotAt,saved.comparison.header.preparedAt,saved.comparison.readAt,exportedAt,'Comparison minus baseline',labels[index],
    saved.baseline.header[field],decimal(saved.baseline.header[field]),saved.comparison.header[field],decimal(saved.comparison.header[field]),saved.changes[field],decimal(saved.changes[field]),saved.baseline.header.unresolvedCount,saved.comparison.header.unresolvedCount,saved.unresolvedChange].map(protect)))};
}
