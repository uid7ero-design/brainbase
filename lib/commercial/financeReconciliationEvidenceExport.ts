import { buildCsv, type CsvCell } from '@/lib/events/csvExport';
import { isFinanceAuditTimestamp } from './financeSetupDisplay';
import { parseReconciliationEvidence,RECONCILIATION_AMOUNT_FIELDS, type ReconciliationEvidence } from './financeReconciliationEvidenceModel';
import { buildReconciliationEvidenceHtml } from './financeReconciliationEvidenceReport';
export type ReconciliationEvidenceDownloadKind='csv'|'json'|'summary-csv'|'events-csv'|'report';

/** Exports use the accepted read only; item coverage stays limited to its page. */
export function buildReconciliationEvidenceDownload(evidence: ReconciliationEvidence, readAt: string, exportedAt: string, kind: ReconciliationEvidenceDownloadKind) {
  if (!['csv','json','summary-csv','events-csv','report'].includes(kind)) throw new Error('Unknown reconciliation export.');
  if (!isFinanceAuditTimestamp(readAt) || !isFinanceAuditTimestamp(exportedAt)) throw new Error('Evidence read times are unavailable.');
  const saved=parseReconciliationEvidence(evidence,evidence.scope,evidence.header.id,evidence.filter,evidence.page);
  const filename=`reconciliation-${saved.header.id.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)}-page-${saved.page}`;
  if(kind==='report')return {filename:`${filename}.html`,type:'text/html;charset=utf-8',content:buildReconciliationEvidenceHtml(saved,readAt,exportedAt)};
  if (kind==='json') return {filename:`${filename}.json`,type:'application/json;charset=utf-8',content:JSON.stringify({
    format:'brainbase-reconciliation-evidence-page',version:1,readCompletedAt:readAt,exportedAt,
    purpose:'Loaded saved header and lifecycle events with the displayed comparison page only. All-item counts and totals cover the complete saved snapshot. Read times are browser observations, not database snapshot timestamps. Not a sign-off or restore file.',evidence:saved,
  },null,2)};
  const protect=(cell:CsvCell):CsvCell=>typeof cell==='string'&&(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)||/^\d+(?:\.\d+)?$/.test(cell))?`'${cell}`:cell;
  const decimal=(cents:string)=>{const amount=BigInt(cents),absolute=amount<BigInt(0)?-amount:amount;return `${amount<BigInt(0)?'-':''}${absolute/BigInt(100)}.${(absolute%BigInt(100)).toString().padStart(2,'0')}`;};
  const contextHeaders=['Reconciliation ID','Status observed at read','Latest at read','Year ID','Period ID','Source','Currency','Snapshot at ISO','Read completed at ISO','Download requested at ISO'];
  const context=[saved.header.id,saved.header.status,String(saved.header.latest),saved.scope.yearId,saved.scope.periodId,saved.scope.source,saved.scope.currency,saved.header.snapshotAt,readAt,exportedAt];
  if(kind==='events-csv')return {filename:`${filename}-lifecycle.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    ...contextHeaders,'Coverage','Event ID','Event type','Event at ISO','Actor','Saved details JSON',
  ],saved.events.map(event=>[...context,'Saved lifecycle events, independent of item page/filter',event.id,event.type,event.at,event.actor,JSON.stringify(event.details)].map(protect)))};
  if(kind==='summary-csv')return {filename:`${filename}-summary.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    ...contextHeaders,'Coverage','Measure','Saved header cents','Saved header amount','All-item aggregate cents','All-item aggregate amount','Total saved items','Unresolved items','Displayed page','Outcome filter','Matching items','Displayed item count','Prepared at ISO','Prepared by','Reviewed at ISO','Reviewed by','Close ID','Notes value state','Saved notes',
  ],RECONCILIATION_AMOUNT_FIELDS.map((field,index)=>[...context,'All saved items',['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'][index],saved.header[field],decimal(saved.header[field]),saved.totals[field],decimal(saved.totals[field]),saved.totalCount,saved.unresolvedCount,saved.page,saved.filter||'ALL',saved.filteredCount,saved.items.length,saved.header.preparedAt,saved.header.preparedBy,saved.header.reviewedAt,saved.header.reviewedBy,saved.header.closeId,saved.header.notes===null?'NOT_RECORDED':saved.header.notes===''?'EMPTY_TEXT':'RECORDED',saved.header.notes].map(protect)))};
  return {filename:`${filename}.csv`,type:'text/csv;charset=utf-8',content:buildCsv([
    'Reconciliation ID','Saved status','Latest at read','Year ID','Period ID','Source','Currency','Snapshot at ISO','Read completed at ISO','Exported at ISO',
    'Displayed page','Outcome filter','Total saved items','Matching items','Item ID','Outcome','Budget account ID','Budget account code','Cost centre ID','Cost centre code',
    'Account mapping ID','Cost centre mapping ID','External account code','External cost centre code','Source Actual cents','Source Actual amount','Finance adjustment cents','Finance adjustment amount','Effective Actual cents','Effective Actual amount','External GL cents','External GL amount','Variance cents','Variance amount','Source count','External entry count',
  ],saved.items.map(item=>[saved.header.id,saved.header.status,String(saved.header.latest),saved.scope.yearId,saved.scope.periodId,saved.scope.source,saved.scope.currency,
    saved.header.snapshotAt,readAt,exportedAt,saved.page,saved.filter||'ALL',saved.totalCount,saved.filteredCount,item.id,item.outcome,item.accountId,item.accountCode,item.centreId,item.centreCode,
    item.accountMappingId,item.centreMappingId,item.externalAccountCode,item.externalCentreCode,item.sourceActualCents,decimal(item.sourceActualCents),item.financeAdjustmentCents,decimal(item.financeAdjustmentCents),item.effectiveActualCents,decimal(item.effectiveActualCents),item.externalGlCents,decimal(item.externalGlCents),item.varianceCents,decimal(item.varianceCents),item.sourceCount,item.externalCount].map(protect)))};
}
