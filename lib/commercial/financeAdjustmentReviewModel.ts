import { isFinanceAuditTimestamp } from './financeSetupDisplay';
export type AdjustmentStatus='DRAFT'|'POSTED'|'REVERSED';
export type AdjustmentHeader={id:string;number:string;status:AdjustmentStatus;type:string;periodId:string;periodName:string;referencePeriodId:string|null;currency:string;description:string;reason:string;sourceType:string|null;sourceId:string|null;reversalOf:string|null;createdBy:string;createdAt:string;postedBy:string|null;postedAt:string|null;reversedBy:string|null;reversedAt:string|null};
export type AdjustmentLine={id:string;position:number;accountId:string;accountCode:string;accountName:string;centreId:string;centreCode:string;centreName:string;exclusiveCents:string;taxCents:string;inclusiveCents:string;resolvedBudgetId:string|null;resolvedVersionId:string|null;resolvedLineId:string|null;resolvedBasis:'EXCLUSIVE'|'INCLUSIVE'|null;budgetCents:string|null;sourceBillLineId:string|null;narrative:string|null};
export type AdjustmentEvent={id:string;type:'CREATED'|'POSTED'|'REVERSED';actor:string;at:string;details:Record<string,unknown>};
export type AdjustmentScope={periodId:string;currency:string;status:''|AdjustmentStatus};
export type AdjustmentRegister={scope:AdjustmentScope;page:number;pageSize:25;totalCount:number;adjustments:AdjustmentHeader[]};
export type AdjustmentEvidence={adjustment:AdjustmentHeader;lines:AdjustmentLine[];events:AdjustmentEvent[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string';
const identity=(value:unknown)=>text(value)&&(value as string).trim()!=='';
const nullable=(check:(value:unknown)=>boolean)=>(value:unknown)=>value===null||check(value);
const amount=(value:unknown)=>typeof value==='string'&&/^-?(0|[1-9]\d*)$/.test(value)&&value.length<=20&&BigInt(value)>=BigInt('-9223372036854775808')&&BigInt(value)<=BigInt('9223372036854775807');
export function validAdjustmentHeader(value:unknown):value is AdjustmentHeader{
  if(!object(value))return false;
  return ['id','type','periodId','periodName','description','reason','createdBy'].every(key=>identity(value[key]))
    && typeof value.number==='string'&&/^[1-9]\d*$/.test(value.number)
    && typeof value.status==='string'&&['DRAFT','POSTED','REVERSED'].includes(value.status)
    && ['PRIOR_PERIOD_RECLASSIFICATION','BUDGET_CLASSIFICATION_CORRECTION','EXTERNAL_GL_TRUE_UP','MANUAL_FINANCE_ADJUSTMENT'].includes(String(value.type))
    && typeof value.currency==='string'&&/^[A-Z]{3}$/.test(value.currency)
    && ['referencePeriodId','sourceType','sourceId','reversalOf','postedBy','reversedBy'].every(key=>nullable(identity)(value[key]))
    && isFinanceAuditTimestamp(value.createdAt)&&nullable(isFinanceAuditTimestamp)(value.postedAt)&&nullable(isFinanceAuditTimestamp)(value.reversedAt)
    && (value.status==='DRAFT'?value.postedAt===null&&value.postedBy===null&&value.reversedAt===null&&value.reversedBy===null&&value.reversalOf===null:
      identity(value.postedBy)&&isFinanceAuditTimestamp(value.postedAt)&&(value.status==='POSTED'?value.reversedAt===null&&value.reversedBy===null:identity(value.reversedBy)&&isFinanceAuditTimestamp(value.reversedAt)&&value.reversalOf===null));
}
export function parseAdjustmentRegister(value:unknown,scope:AdjustmentScope,page:number):AdjustmentRegister{
  if(!object(value)||!object(value.scope)||value.scope.periodId!==scope.periodId||value.scope.currency!==scope.currency||value.scope.status!==scope.status
    ||value.page!==page||value.pageSize!==25||!Number.isSafeInteger(value.totalCount)||Number(value.totalCount)<0||!Array.isArray(value.adjustments)
    ||!value.adjustments.every(validAdjustmentHeader)||new Set(value.adjustments.map(row=>row.id)).size!==value.adjustments.length
    ||value.adjustments.length!==Math.min(25,Math.max(0,Number(value.totalCount)-(page-1)*25))
    ||value.adjustments.some(row=>row.periodId!==scope.periodId||row.currency!==scope.currency||(scope.status&&row.status!==scope.status)))throw new Error('Saved adjustment register is incomplete or belongs to a different period, currency or status.');
  return value as unknown as AdjustmentRegister;
}
export function parseAdjustmentEvidence(value:unknown,scope:AdjustmentScope,id:string):AdjustmentEvidence{
  const fail=()=>{throw new Error('Saved adjustment evidence is incomplete or belongs to a different adjustment scope.');};
  if(!object(value)||!validAdjustmentHeader(value.adjustment)||value.adjustment.id!==id||value.adjustment.periodId!==scope.periodId||value.adjustment.currency!==scope.currency||(scope.status&&value.adjustment.status!==scope.status)||!Array.isArray(value.lines)||!Array.isArray(value.events))return fail();
  const lines=value.lines;
  for(const line of lines){
    if(!object(line)||!['id','accountId','accountCode','accountName','centreId','centreCode','centreName'].every(key=>identity(line[key]))
      ||!Number.isSafeInteger(line.position)||Number(line.position)<1||!['exclusiveCents','taxCents','inclusiveCents'].every(key=>amount(line[key]))
      ||BigInt(line.exclusiveCents as string)+BigInt(line.taxCents as string)!==BigInt(line.inclusiveCents as string)
      ||!['resolvedBudgetId','resolvedVersionId','resolvedLineId','sourceBillLineId'].every(key=>nullable(identity)(line[key]))||!nullable(text)(line.narrative)
      ||![null,'EXCLUSIVE','INCLUSIVE'].includes(line.resolvedBasis as string|null)||!nullable(amount)(line.budgetCents))return fail();
    const resolved=[line.resolvedBudgetId,line.resolvedVersionId,line.resolvedLineId,line.resolvedBasis,line.budgetCents];
    if(!resolved.every(item=>item===null)&&!resolved.every(item=>item!==null))return fail();
    if(line.resolvedBasis!==null&&line.budgetCents!==(line.resolvedBasis==='EXCLUSIVE'?line.exclusiveCents:line.inclusiveCents))return fail();
  }
  if(value.adjustment.status!=='DRAFT'&&(lines.length===0||lines.some(line=>line.resolvedBasis===null)))return fail();
  if(new Set(lines.map(line=>line.id)).size!==lines.length||new Set(lines.map(line=>line.position)).size!==lines.length)return fail();
  const events=value.events;
  if(!events.every(event=>object(event)&&identity(event.id)&&identity(event.actor)&&typeof event.type==='string'&&['CREATED','POSTED','REVERSED'].includes(event.type)&&isFinanceAuditTimestamp(event.at)&&object(event.details)
    &&['reason','reversalOf','reversalAdjustmentId','generatedByReversalOf'].every(key=>(event.details as Record<string,unknown>)[key]===undefined||text((event.details as Record<string,unknown>)[key])))||new Set(events.map(event=>event.id)).size!==events.length
    ||!events.some(event=>event.type==='CREATED')||(value.adjustment.status!=='DRAFT'&&!events.some(event=>event.type==='POSTED'))||(value.adjustment.status==='REVERSED'&&!events.some(event=>event.type==='REVERSED')))return fail();
  const expected={CREATED:1,POSTED:value.adjustment.status==='DRAFT'?0:1,REVERSED:value.adjustment.status==='REVERSED'?1:0};
  if(Object.entries(expected).some(([type,count])=>events.filter(event=>event.type===type).length!==count))return fail();
  return value as unknown as AdjustmentEvidence;
}
export function adjustmentLineTotals(lines:AdjustmentLine[]){return (['exclusiveCents','taxCents','inclusiveCents'] as const).map(field=>lines.reduce((sum,line)=>sum+BigInt(line[field]),BigInt(0)).toString());}
