import { isFinanceAuditTimestamp } from './financeSetupDisplay';

export const RECONCILIATION_OUTCOMES = ['RECONCILED','VARIANCE','UNMAPPED_BRAINBASE_ACCOUNT','UNMAPPED_EXTERNAL_GL_ACCOUNT','UNMAPPED_COST_CENTRE','MISSING_EXTERNAL_ENTRY','EXTERNAL_ONLY_ENTRY'] as const;
export type ReconciliationOutcome = typeof RECONCILIATION_OUTCOMES[number];
export type ReconciliationEvidenceFilter = '' | 'UNRESOLVED' | ReconciliationOutcome;
export type ReconciliationEvidenceScope = { yearId: string; periodId: string; source: string; currency: string };
export const RECONCILIATION_AMOUNT_FIELDS = ['sourceActualCents','financeAdjustmentCents','effectiveActualCents','externalGlCents','varianceCents'] as const;
type Amounts = Record<typeof RECONCILIATION_AMOUNT_FIELDS[number], string>;
export type ReconciliationEvidenceHeader = Amounts & {
  id: string; yearId: string; yearName: string; periodId: string; periodName: string; source: string; currency: string;
  status: 'PREPARED'|'REVIEWED'|'SIGNED_OFF'|'STALE'; closeId: string|null; snapshotAt: string; preparedAt: string;
  preparedBy: string; reviewedBy: string|null; reviewedAt: string|null; notes: string|null; latest: boolean; unresolvedCount: number;
};
export type ReconciliationEvidenceItem = Amounts & {
  id: string; currency: string; accountId: string|null; accountCode: string|null; centreId: string|null; centreCode: string|null;
  accountMappingId: string|null; centreMappingId: string|null; externalAccountCode: string|null; externalCentreCode: string|null;
  sourceCount: number; externalCount: number; outcome: ReconciliationOutcome;
};
export type ReconciliationEvidenceEvent = { id: string; type: string; actor: string; at: string; details: Record<string, unknown> };
export type ReconciliationEvidence = {
  scope: ReconciliationEvidenceScope; filter: ReconciliationEvidenceFilter; page: number; pageSize: 25;
  totalCount: number; filteredCount: number; unresolvedCount: number; totals: Amounts;
  header: ReconciliationEvidenceHeader; items: ReconciliationEvidenceItem[]; events: ReconciliationEvidenceEvent[];
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const amount = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && /^-?(0|[1-9]\d*)$/.test(value);
function amounts(value: Record<string, unknown>): boolean {
  return RECONCILIATION_AMOUNT_FIELDS.every(field => amount(value[field]))
    && BigInt(value.sourceActualCents as string) + BigInt(value.financeAdjustmentCents as string) === BigInt(value.effectiveActualCents as string)
    && BigInt(value.effectiveActualCents as string) - BigInt(value.externalGlCents as string) === BigInt(value.varianceCents as string);
}
export function validReconciliationEvidenceHeader(value:unknown):value is ReconciliationEvidenceHeader{
  if(!object(value))return false;
  return ['id','yearId','yearName','periodId','periodName','source','preparedBy'].every(key=>identity(value[key]))
    &&typeof value.currency==='string'&&/^[A-Z]{3}$/.test(value.currency)&&['PREPARED','REVIEWED','SIGNED_OFF','STALE'].includes(String(value.status))
    &&isFinanceAuditTimestamp(value.snapshotAt)&&isFinanceAuditTimestamp(value.preparedAt)&&typeof value.latest==='boolean'&&count(value.unresolvedCount)
    &&nullableText(value.notes)&&(value.closeId===null||identity(value.closeId))&&(value.reviewedBy===null||identity(value.reviewedBy))
    &&(value.reviewedAt===null||isFinanceAuditTimestamp(value.reviewedAt))&&(value.reviewedAt===null)===(value.reviewedBy===null)
    &&(!['REVIEWED','SIGNED_OFF'].includes(String(value.status))||value.reviewedAt!==null)
    &&(value.status!=='SIGNED_OFF'||value.closeId!==null)&&amounts(value);
}
export function parseReconciliationEvidence(value: unknown, scope: ReconciliationEvidenceScope, id: string, filter: ReconciliationEvidenceFilter, page: number): ReconciliationEvidence {
  const fail = (): never => { throw new Error('Saved reconciliation evidence is incomplete or belongs to different filters.'); };
  const sameScope = (candidate: unknown) => object(candidate) && Object.entries(scope).every(([key, expected]) => candidate[key] === expected);
  if (!Object.values(scope).every(identity) || scope.source !== scope.source.trim() || !/^[A-Z]{3}$/.test(scope.currency) || !identity(id)
    || !Number.isSafeInteger(page) || page < 1 || page > 100000 || !['','UNRESOLVED',...RECONCILIATION_OUTCOMES].includes(filter)
    || !object(value) || !sameScope(value.scope)
    || value.filter !== filter || value.page !== page || value.pageSize !== 25 || !count(value.totalCount) || !count(value.filteredCount) || !count(value.unresolvedCount)
    || Number(value.filteredCount) > Number(value.totalCount) || Number(value.unresolvedCount) > Number(value.totalCount)
    || !object(value.header) || !object(value.totals) || !amounts(value.totals) || !Array.isArray(value.items) || !Array.isArray(value.events)) return fail();
  const header = value.header;
  const items=value.items,events=value.events,totals=value.totals;
  if (!validReconciliationEvidenceHeader(header)||header.id !== id || !sameScope(header)||header.unresolvedCount !== value.unresolvedCount
    || RECONCILIATION_AMOUNT_FIELDS.some(field => BigInt(header[field] as string) !== BigInt(totals[field] as string))) return fail();
  if (items.length !== Math.min(25, Math.max(0, Number(value.filteredCount) - (page - 1) * 25)) || new Set(items.map(item => item?.id)).size !== items.length) return fail();
  for (const item of items) {
    if (!object(item) || !identity(item.id) || item.currency !== scope.currency || !amounts(item) || !count(item.sourceCount) || !count(item.externalCount)
      || !['accountId','centreId','accountMappingId','centreMappingId'].every(key => item[key] === null || identity(item[key]))
      || !['accountCode','centreCode','externalAccountCode','externalCentreCode'].every(key => nullableText(item[key]))
      || !RECONCILIATION_OUTCOMES.some(outcome => outcome === item.outcome)
      || (filter === 'UNRESOLVED' ? item.outcome === 'RECONCILED' : filter !== '' && item.outcome !== filter)) return fail();
  }
  if ((filter === '' && value.filteredCount !== value.totalCount) || (filter === 'UNRESOLVED' && value.filteredCount !== value.unresolvedCount)) return fail();
  if (filter === 'RECONCILED' && value.filteredCount !== Number(value.totalCount) - Number(value.unresolvedCount)) return fail();
  if (filter === '' && items.length === value.totalCount) {
    if (items.filter(item => item.outcome !== 'RECONCILED').length !== value.unresolvedCount
      || RECONCILIATION_AMOUNT_FIELDS.some(field => items.reduce((sum: bigint, item: ReconciliationEvidenceItem) => sum + BigInt(item[field]), BigInt(0)) !== BigInt(header[field] as string))) return fail();
  }
  if (!events.every(event => object(event) && identity(event.id) && identity(event.actor) && ['PREPARED','REVIEWED','SIGNED_OFF','STALE'].includes(String(event.type))
    && isFinanceAuditTimestamp(event.at) && object(event.details)) || new Set(events.map(event => event.id)).size !== events.length
    || !events.some(event => event.type === 'PREPARED')
    || (['REVIEWED','SIGNED_OFF'].includes(String(header.status)) && !events.some(event => event.type === 'REVIEWED'))
    || (header.status === 'SIGNED_OFF' && !events.some(event => event.type === 'SIGNED_OFF'))
    || (header.status === 'STALE' && !events.some(event => event.type === 'STALE'))) return fail();
  return value as unknown as ReconciliationEvidence;
}
