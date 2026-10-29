import type { AdjustmentEvent,AdjustmentLine } from './financeAdjustmentReviewModel';

export function adjustmentSavedText(value:string|null):string{
  return value===null?'Not supplied':value===''?'Empty saved text':value;
}
export function adjustmentLifecycleLabel(type:AdjustmentEvent['type']):string{
  switch(type){case 'CREATED':return 'Adjustment created';case 'POSTED':return 'Posting recorded';case 'REVERSED':return 'Reversal recorded';}
}
/** Counts describe the validated selected record, not current Budget readiness. */
export function adjustmentClassificationCoverage(lines:AdjustmentLine[]){
  const resolved=lines.filter(line=>line.resolvedBasis!==null).length;
  return {total:lines.length,resolved,unresolved:lines.length-resolved};
}
