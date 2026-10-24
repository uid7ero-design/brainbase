import { buildCsv,type CsvCell } from '@/lib/events/csvExport';
import { isFinanceAuditTimestamp } from './financeSetupDisplay';
import { RECONCILIATION_AMOUNT_FIELDS } from './financeReconciliationEvidenceModel';
import { parseReconciliationHistory,type ReconciliationHistory } from './financeReconciliationHistoryModel';
import { buildReconciliationHistoryHtml } from './financeReconciliationHistoryReport';
export type ReconciliationHistoryDownloadKind='csv'|'json'|'report';
export function buildReconciliationHistoryDownload(history:ReconciliationHistory,readAt:string,exportedAt:string,kind:ReconciliationHistoryDownloadKind){
  if(!['csv','json','report'].includes(kind)||!isFinanceAuditTimestamp(readAt)||!isFinanceAuditTimestamp(exportedAt))throw new Error('History export metadata is unavailable.');
  const saved=parseReconciliationHistory(history,history.scope,history.status,history.page);
  const filename=`reconciliation-history-${saved.scope.currency}-period-${saved.scope.periodId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)}-page-${saved.page}`;
  if(kind==='report')return {filename:`${filename}.html`,type:'text/html;charset=utf-8',content:buildReconciliationHistoryHtml(saved,readAt,exportedAt)};
  if(kind==='json')return {filename:`${filename}.json`,type:'application/json;charset=utf-8',content:JSON.stringify({
    format:'brainbase-reconciliation-history-page',version:1,readCompletedAt:readAt,exportedAt,
    purpose:'Displayed saved-header page only. Matching count covers all filtered history. Snapshot versions are separate and must not be summed. Item and lifecycle details require separate inspection. Not a restore file or sign-off.',history:saved,
  },null,2)};
  const protect=(cell:CsvCell):CsvCell=>typeof cell==='string'&&(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)||/^\d+(?:\.\d+)?$/.test(cell))?`'${cell}`:cell;
  const decimal=(cents:string)=>{const value=BigInt(cents),absolute=value<BigInt(0)?-value:value;return `${value<BigInt(0)?'-':''}${absolute/BigInt(100)}.${(absolute%BigInt(100)).toString().padStart(2,'0')}`;};
  const moneyHeaders=['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'].flatMap(label=>[`${label} cents`,`${label} amount`]);
  return {filename:`${filename}.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    'Read completed at ISO','Exported at ISO','Page','Matching snapshots','Selected lifecycle status','Year ID','Year','Period ID','Period','Source','Currency','Reconciliation ID','Saved status','Latest snapshot at read','Snapshot at ISO','Prepared at ISO','Prepared by','Reviewed at ISO','Reviewed by','Close ID','Unresolved items',...moneyHeaders,'Notes',
  ],saved.records.map(row=>[readAt,exportedAt,saved.page,saved.totalCount,saved.status||'ALL',row.yearId,row.yearName,row.periodId,row.periodName,row.source,row.currency,row.id,row.status,String(row.latest),row.snapshotAt,row.preparedAt,row.preparedBy,row.reviewedAt,row.reviewedBy,row.closeId,row.unresolvedCount,
    ...RECONCILIATION_AMOUNT_FIELDS.flatMap(field=>[row[field],decimal(row[field])]),row.notes].map(protect)))};
}
