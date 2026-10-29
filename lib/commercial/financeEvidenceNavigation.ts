import type { CloseEvidenceScope } from './financeCloseEvidenceModel';
import type { ReconciliationEvidenceScope } from './financeReconciliationEvidenceModel';

export type FinanceEvidenceTarget={kind:'close';id:string;scope:CloseEvidenceScope}|{kind:'reconciliation';id:string;scope:ReconciliationEvidenceScope};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value);
export function isFinanceEvidenceTarget(value:unknown):value is FinanceEvidenceTarget{
  if(!object(value)||!identifier(value.id)||!object(value.scope)||!identifier(value.scope.yearId))return false;
  const scope=value.scope;
  if(value.kind==='close')return scope.kind==='year'?scope.periodId===null:scope.kind==='period'&&identifier(scope.periodId);
  return value.kind==='reconciliation'&&identifier(scope.periodId)&&typeof scope.source==='string'&&!!scope.source.trim()&&scope.source===scope.source.trim()
    &&scope.source.length<=300&&typeof scope.currency==='string'&&/^[A-Z]{3}$/.test(scope.currency);
}
export function periodCloseEvidenceTarget(yearId:string,periodId:string,id:string|null):FinanceEvidenceTarget|null{
  const target={kind:'close' as const,id,scope:{kind:'period' as const,yearId,periodId}};
  return isFinanceEvidenceTarget(target)?target:null;
}
export function reconciliationEvidenceTarget(yearId:string,periodId:string,id:string,source:string,currency:string):FinanceEvidenceTarget|null{
  const target={kind:'reconciliation' as const,id,scope:{yearId,periodId,source,currency}};
  return isFinanceEvidenceTarget(target)?target:null;
}
export function financeEvidenceTargetKey(target:FinanceEvidenceTarget):string{
  return JSON.stringify(target.kind==='close'?[target.kind,target.id,target.scope.kind,target.scope.yearId,target.scope.periodId]
    :[target.kind,target.id,target.scope.yearId,target.scope.periodId,target.scope.source,target.scope.currency]);
}
export function financeEvidenceTargetLabel(target:FinanceEvidenceTarget):string{
  return target.kind==='close'?`${target.scope.kind==='year'?'Year':'Period'} close · ${target.id}`:`${target.scope.source} · ${target.scope.currency} reconciliation · ${target.id}`;
}
export function financeEvidenceTargetShortLabel(target:FinanceEvidenceTarget):string{
  return target.kind==='close'?`${target.scope.kind==='year'?'Year':'Period'} close`:`${target.scope.source} · ${target.scope.currency} reconciliation`;
}
/** Related links stay in one calendar context and never update control scope. */
export function followFinanceEvidence(trail:FinanceEvidenceTarget[],next:FinanceEvidenceTarget):FinanceEvidenceTarget[]{
  if(!trail.length||!trail.every(isFinanceEvidenceTarget)||!isFinanceEvidenceTarget(next))throw new Error('The related evidence reference is incomplete.');
  const root=trail[0];
  if(!root||root.scope.yearId!==next.scope.yearId||root.scope.periodId!==next.scope.periodId
    ||trail.some(target=>target.scope.yearId!==root.scope.yearId||target.scope.periodId!==root.scope.periodId))throw new Error('The related evidence belongs to a different calendar scope.');
  const existing=trail.findIndex(target=>financeEvidenceTargetKey(target)===financeEvidenceTargetKey(next));
  if(existing>=0)return trail.slice(0,existing+1);
  if(trail.length>=16)throw new Error('Return to an earlier record before extending this inspection trail.');
  return [...trail,next];
}

/** Only in-memory references are retained, never previously loaded evidence. */
export type FinanceEvidencePosition={trail:FinanceEvidenceTarget[];index:number};
export function selectFinanceEvidencePosition(trail:FinanceEvidenceTarget[],index:number):FinanceEvidencePosition{
  if(!Number.isSafeInteger(index)||index<0||index>=trail.length||trail.length>16
    ||!trail.every(isFinanceEvidenceTarget)||new Set(trail.map(financeEvidenceTargetKey)).size!==trail.length)throw new Error('The requested inspection position is unavailable.');
  const target=trail[index];
  if(!target)throw new Error('The requested inspection position is unavailable.');
  followFinanceEvidence(trail,target);
  return {trail,index};
}
export function followFinanceEvidenceFrom(position:FinanceEvidencePosition,next:FinanceEvidenceTarget):FinanceEvidencePosition{
  selectFinanceEvidencePosition(position.trail,position.index);
  if(!isFinanceEvidenceTarget(next))throw new Error('The related evidence reference is incomplete.');
  const existing=position.trail.findIndex(target=>financeEvidenceTargetKey(target)===financeEvidenceTargetKey(next));
  if(existing>=0)return selectFinanceEvidencePosition(position.trail,existing);
  // A newly followed branch replaces forward references, like browser history.
  const trail=followFinanceEvidence(position.trail.slice(0,position.index+1),next);
  return {trail,index:trail.length-1};
}
