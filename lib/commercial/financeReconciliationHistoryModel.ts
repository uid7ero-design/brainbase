import { validReconciliationEvidenceHeader,type ReconciliationEvidenceHeader,type ReconciliationEvidenceScope } from './financeReconciliationEvidenceModel';
export const RECONCILIATION_HISTORY_STATUSES=['PREPARED','REVIEWED','SIGNED_OFF','STALE'] as const;
export type ReconciliationHistoryStatus=''|typeof RECONCILIATION_HISTORY_STATUSES[number];
export type ReconciliationHistory={scope:ReconciliationEvidenceScope;status:ReconciliationHistoryStatus;page:number;pageSize:25;totalCount:number;records:ReconciliationEvidenceHeader[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function parseReconciliationHistory(value:unknown,scope:ReconciliationEvidenceScope,status:ReconciliationHistoryStatus,page:number):ReconciliationHistory{
  const sameScope=(candidate:unknown)=>object(candidate)&&Object.entries(scope).every(([key,expected])=>candidate[key]===expected);
  if(!Object.values(scope).every(part=>typeof part==='string'&&!!part.trim())||scope.source!==scope.source.trim()||scope.source.length>300||!/^[A-Z]{3}$/.test(scope.currency)
    ||!['',...RECONCILIATION_HISTORY_STATUSES].includes(status)||!Number.isSafeInteger(page)||page<1||page>100000
    ||!object(value)||!sameScope(value.scope)||value.status!==status||value.page!==page||value.pageSize!==25||!Number.isSafeInteger(value.totalCount)||Number(value.totalCount)<0
    ||!Array.isArray(value.records)||value.records.length!==Math.min(25,Math.max(0,Number(value.totalCount)-(page-1)*25))
    ||!value.records.every(row=>validReconciliationEvidenceHeader(row)&&sameScope(row)&&(!status||row.status===status))
    ||new Set(value.records.map(row=>row.id)).size!==value.records.length||value.records.filter(row=>row.latest).length>1)throw new Error('Saved reconciliation history is incomplete or belongs to different filters.');
  return value as unknown as ReconciliationHistory;
}
