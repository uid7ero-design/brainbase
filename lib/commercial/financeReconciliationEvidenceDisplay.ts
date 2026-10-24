import type { ReconciliationOutcome } from './financeReconciliationEvidenceModel';

/** Explains the saved classification; never derives a replacement outcome. */
export const RECONCILIATION_OUTCOME_GUIDANCE:Record<ReconciliationOutcome,{label:string;meaning:string;review:string}>={
  RECONCILED:{label:'Reconciled',meaning:'The saved comparison found matching Effective Actual and External GL amounts for this row.',review:'Inspect the saved amounts and scope. Matching amounts alone do not establish review or sign-off.'},
  VARIANCE:{label:'Amount difference',meaning:'The saved comparison found a difference between Effective Actual and External GL amounts.',review:'Compare the saved source, adjustment and external amounts. Inspect underlying evidence before deciding whether any correction is needed.'},
  UNMAPPED_BRAINBASE_ACCOUNT:{label:'BrainBase account mapping missing',meaning:'The saved comparison could not find a covering External GL account mapping for this BrainBase account.',review:'Review the account mapping and its effective dates for the saved scope. This historical row does not establish the mapping state today.'},
  UNMAPPED_EXTERNAL_GL_ACCOUNT:{label:'External GL account mapping missing',meaning:'The saved comparison could not map this External GL account into BrainBase.',review:'Review the external account code and mapping for the saved source and period. Do not treat its comparison amount as proof of a matching BrainBase entry.'},
  UNMAPPED_COST_CENTRE:{label:'Cost-centre comparison unresolved',meaning:'The saved comparison could not resolve this external entry at the required cost-centre level.',review:'Review the saved account and cost-centre codes, mappings and comparison level. A blank identity alone does not identify the cause.'},
  MISSING_EXTERNAL_ENTRY:{label:'External entry missing',meaning:'The saved comparison had a BrainBase row without a corresponding external entry at its comparison level.',review:'Review the imported external evidence and selected period/source. A saved zero on the external side does not establish that the expected entry was present.'},
  EXTERNAL_ONLY_ENTRY:{label:'External-only entry',meaning:'The saved comparison had an external row without a corresponding BrainBase row at its comparison level.',review:'Review the external evidence, selected scope and expected BrainBase activity. This classification does not decide whether an adjustment is appropriate.'},
};

export function reconciliationDimensionLabel(id:string|null,code:string|null):string{
  return code===null?(id?'Label unavailable at read':'Not recorded for this row'):code===''?'Empty label at read':code;
}
export function reconciliationSavedText(value:string|null):string{
  return value===null?'Not recorded for this row':value===''?'Empty saved text':value;
}
export function reconciliationLifecycleLabel(type:string):string{
  switch(type){case 'PREPARED':return 'Snapshot prepared';case 'REVIEWED':return 'Review recorded';case 'SIGNED_OFF':return 'Sign-off recorded';case 'STALE':return 'Marked stale';default:return type;}
}
