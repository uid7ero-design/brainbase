import { isFinanceAuditTimestamp,isFinanceCalendarDate } from './financeSetupDisplay';

export type CloseEvidenceScope={kind:'year'|'period';yearId:string;periodId:string|null};
export type CloseSourceTotal={currency:string;lineCount:number;subtotalCents:string;taxCents:string;totalCents:string};
export type CloseEvidence={
  id:string;kind:'year'|'period';yearId:string;yearName:string;periodId:string|null;periodName:string|null;
  calendarStatus:'OPEN'|'CLOSED';startsOn:string;endsOn:string;sequence:number;status:'CLOSED'|'INVALIDATED';
  closedBy:string;closedAt:string;closeReason:string|null;invalidatedBy:string|null;invalidatedAt:string|null;invalidationReason:string|null;
  reconciliationStatus:string|null;controlTotals:Record<string,unknown>;current:boolean;laterCloseExists:boolean;
  linkedReconciliations:Array<{id:string;source:string;currency:string;status:'PREPARED'|'REVIEWED'|'SIGNED_OFF'|'STALE'}>;
};
export type CloseControlSummary={kind:'source';rows:CloseSourceTotal[]}|{kind:'year';periodCount:number;closeCount:number}|{kind:'unknown'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const nullableText=(value:unknown)=>value===null||typeof value==='string';
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const cents=(value:unknown):value is string=>typeof value==='string'&&value.length<=80&&/^-?(0|[1-9]\d*)$/.test(value);
export function closeControlSummary(evidence:CloseEvidence):CloseControlSummary{
  const raw=evidence.controlTotals;
  if(evidence.kind==='period'&&raw.basis==='C7_8_SOURCE_ACTUAL'){
    if(!Array.isArray(raw.sourceActualByCurrency)||!raw.sourceActualByCurrency.every(row=>object(row)&&typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency)&&count(row.lineCount)
      &&cents(row.subtotalCents)&&cents(row.taxCents)&&cents(row.totalCents)&&BigInt(row.subtotalCents)+BigInt(row.taxCents)===BigInt(row.totalCents))
      ||new Set(raw.sourceActualByCurrency.map(row=>row.currency)).size!==raw.sourceActualByCurrency.length)throw new Error('Saved close currency totals are incomplete.');
    return {kind:'source',rows:raw.sourceActualByCurrency as CloseSourceTotal[]};
  }
  if(evidence.kind==='year'&&raw.basis==='C7_9_YEAR_CLOSE'){
    if(!count(raw.financialPeriodCount)||!count(raw.currentPeriodCloseCount)||raw.currentPeriodCloseCount>raw.financialPeriodCount)throw new Error('Saved year-close counts are incomplete.');
    return {kind:'year',periodCount:raw.financialPeriodCount,closeCount:raw.currentPeriodCloseCount};
  }
  return {kind:'unknown'};
}
export function parseCloseEvidence(value:unknown,scope:CloseEvidenceScope,id:string):CloseEvidence{
  const fail=():never=>{throw new Error('Saved close evidence is incomplete or belongs to a different calendar scope.');};
  if(!['year','period'].includes(scope.kind)||!identity(scope.yearId)||!identity(id)||!object(value)||value.id!==id||value.kind!==scope.kind||value.yearId!==scope.yearId||value.periodId!==scope.periodId
    ||!identity(value.yearName)||!identity(value.closedBy)||!['OPEN','CLOSED'].includes(String(value.calendarStatus))||!['CLOSED','INVALIDATED'].includes(String(value.status))
    ||!isFinanceCalendarDate(value.startsOn)||!isFinanceCalendarDate(value.endsOn)||value.startsOn>value.endsOn||!count(value.sequence)||value.sequence<1
    ||!isFinanceAuditTimestamp(value.closedAt)||!nullableText(value.closeReason)||!object(value.controlTotals)||typeof value.current!=='boolean'||typeof value.laterCloseExists!=='boolean'
    ||!(value.invalidatedBy===null||identity(value.invalidatedBy))||!(value.invalidatedAt===null||isFinanceAuditTimestamp(value.invalidatedAt))||!nullableText(value.invalidationReason)
    ||(scope.kind==='period'?(!identity(scope.periodId)||!identity(value.periodName)||!identity(value.reconciliationStatus)):value.periodName!==null||value.reconciliationStatus!==null||scope.periodId!==null)
    ||(value.status==='CLOSED'?(value.invalidatedBy!==null||value.invalidatedAt!==null||value.invalidationReason!==null):(!identity(value.invalidatedBy)||!isFinanceAuditTimestamp(value.invalidatedAt)||!identity(value.invalidationReason)))
    ||value.current!==(value.status==='CLOSED'&&value.calendarStatus==='CLOSED'&&!value.laterCloseExists)
    ||!Array.isArray(value.linkedReconciliations)||!value.linkedReconciliations.every(row=>object(row)&&identity(row.id)&&identity(row.source)&&typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency)&&['PREPARED','REVIEWED','SIGNED_OFF','STALE'].includes(String(row.status)))
    ||new Set(value.linkedReconciliations.map(row=>row.id)).size!==value.linkedReconciliations.length||(scope.kind==='year'&&value.linkedReconciliations.length!==0))return fail();
  const evidence=value as unknown as CloseEvidence;closeControlSummary(evidence);return evidence;
}
