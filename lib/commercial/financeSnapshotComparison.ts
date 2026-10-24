import { formatAustralianTimestamp,isFinanceAuditTimestamp } from './financeSetupDisplay';
import { RECONCILIATION_AMOUNT_FIELDS,validReconciliationEvidenceHeader,type ReconciliationEvidenceHeader,type ReconciliationEvidenceScope } from './financeReconciliationEvidenceModel';
export type ObservedReconciliationHeader={header:ReconciliationEvidenceHeader;readAt:string};
const HEADER_FIELDS=[['status','Saved lifecycle status'],['closeId','Close reference'],['preparedBy','Prepared by'],['reviewedBy','Reviewed by'],['reviewedAt','Review recorded at'],['notes','Saved notes'],['latest','Latest snapshot at read']] as const;
export type SnapshotHeaderField=typeof HEADER_FIELDS[number][0];
export type SnapshotHeaderValue=string|boolean|null;
export type SnapshotHeaderDifference={field:SnapshotHeaderField;label:string;baseline:SnapshotHeaderValue;comparison:SnapshotHeaderValue;changed:boolean};
export type FinanceSnapshotComparison={scope:ReconciliationEvidenceScope;baseline:ObservedReconciliationHeader;comparison:ObservedReconciliationHeader;changes:Record<typeof RECONCILIATION_AMOUNT_FIELDS[number],string>;unresolvedChange:string;hasAmountChanges:boolean;headerDifferences:SnapshotHeaderDifference[]};
export function formatSnapshotHeaderValue(field:SnapshotHeaderField,value:SnapshotHeaderValue):string{
  if(value===null)return field==='closeId'?'Not linked':field==='notes'?'Not supplied':'Not recorded';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(value==='')return 'Empty saved text';
  return field==='reviewedAt'?`${formatAustralianTimestamp(value)} · ${value}`:value;
}
export function compareFinanceSnapshotTotals(scope:ReconciliationEvidenceScope,baseline:ObservedReconciliationHeader,comparison:ObservedReconciliationHeader):FinanceSnapshotComparison{
  for(const observed of [baseline,comparison]){
    if(!isFinanceAuditTimestamp(observed.readAt)||!validReconciliationEvidenceHeader(observed.header))throw new Error('Both saved snapshot headers and read times are required.');
    const header=observed.header;
    if(header.yearId!==scope.yearId||header.periodId!==scope.periodId||header.source!==scope.source||header.currency!==scope.currency)throw new Error('Compare snapshots from the same year, period, source and currency.');
  }
  if(baseline.header.id===comparison.header.id)throw new Error('Choose two different saved snapshots.');
  const changes=Object.fromEntries(RECONCILIATION_AMOUNT_FIELDS.map(field=>[field,(BigInt(comparison.header[field])-BigInt(baseline.header[field])).toString()])) as FinanceSnapshotComparison['changes'];
  const headerDifferences=HEADER_FIELDS.map(([field,label])=>({field,label,baseline:baseline.header[field],comparison:comparison.header[field],changed:baseline.header[field]!==comparison.header[field]}));
  return {scope,baseline,comparison,changes,unresolvedChange:(BigInt(comparison.header.unresolvedCount)-BigInt(baseline.header.unresolvedCount)).toString(),hasAmountChanges:RECONCILIATION_AMOUNT_FIELDS.some(field=>changes[field]!=='0'),headerDifferences};
}
