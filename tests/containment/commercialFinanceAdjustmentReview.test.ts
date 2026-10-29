import { beforeEach,describe,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAdjustmentRegister,parseAdjustmentEvidence,adjustmentLineTotals,validAdjustmentHeader } from '@/lib/commercial/financeAdjustmentReviewModel';
import { adjustmentScope,adjustmentHeader,adjustmentLine,adjustmentEvents,adjustmentReport,adjustmentEvidence } from '../fixtures/commercialAdjustmentReview';
const queryMock=vi.fn(),authMock=vi.fn();
vi.mock('@/lib/db',()=>({default:{query:(...args:unknown[])=>queryMock(...args)}}));
vi.mock('@/lib/commercial/authorize',async original=>({...await original<typeof import('@/lib/commercial/authorize')>(),authorizeCommercialRequest:(...args:unknown[])=>authMock(...args)}));
const {listFinanceAdjustmentReview,getFinanceAdjustmentEvidence}=await import('@/lib/commercial/financeAdjustmentReview');
const {GET}=await import('@/app/api/commercial/budgeting/finance-adjustments/review/route');
beforeEach(()=>{queryMock.mockReset();authMock.mockReset();});
describe('Scoped immutable finance adjustment review',()=>{
  it('types reversal event metadata parameters for the existing Neon transport',()=>{
    const source=readFileSync('lib/commercial/financeAdjustments.ts','utf8');
    expect(source).toContain("jsonb_build_object('generatedByReversalOf', ${params.financeAdjustmentId}::text)");
    expect(source).toContain("jsonb_build_object('reversalOf', ${params.financeAdjustmentId}::text)");
    expect(source).toContain("jsonb_build_object('reversalAdjustmentId', ${reversalId}::text, 'reason', ${reason}::text)");
  });
  it('preserves exact adjustment number, amounts and sums above the safe integer range',()=>{
    expect(parseAdjustmentRegister(adjustmentReport,adjustmentScope,1).adjustments[0].number).toBe('9007199254740993');
    expect(adjustmentLineTotals([adjustmentLine,{...adjustmentLine,id:'second',position:2}])).toEqual(['18014398509481986','0','18014398509481986']);expect(parseAdjustmentEvidence(adjustmentEvidence,adjustmentScope,adjustmentHeader.id)).toEqual(adjustmentEvidence);
  });
  it.each([{scope:{...adjustmentScope,currency:'USD'}},{adjustments:[]},{page:2},{totalCount:0},{adjustments:[{...adjustmentHeader,periodId:'foreign'}]},{adjustments:[{...adjustmentHeader,postedAt:null}]},{adjustments:[{...adjustmentHeader,status:['POSTED']}]}])('rejects invalid register %j',change=>expect(()=>parseAdjustmentRegister({...adjustmentReport,...change},adjustmentScope,1)).toThrow());
  it.each([{events:[{...adjustmentEvents[0],details:{generatedByReversalOf:{invalid:true}}},adjustmentEvents[1]]},{adjustment:{...adjustmentHeader,id:'other'}},{lines:null},{events:[]},{lines:[]},{lines:[{...adjustmentLine,inclusiveCents:'1'}]},{lines:[{...adjustmentLine,resolvedBasis:null}]},{lines:[{...adjustmentLine,budgetCents:'0'}]},{lines:[{...adjustmentLine,position:1.5}]},{lines:[adjustmentLine,adjustmentLine]},{events:[...adjustmentEvents,adjustmentEvents[0]]},{events:[...adjustmentEvents,{id:'extra',type:'POSTED',actor:'admin',at:adjustmentHeader.createdAt,details:{}}]}])('rejects incomplete or inconsistent detail %j',change=>expect(()=>parseAdjustmentEvidence({...adjustmentEvidence,...change},adjustmentScope,adjustmentHeader.id)).toThrow());
  it('keeps draft unresolved classification distinct from a resolved known zero',()=>{
    const draft={...adjustmentHeader,status:'DRAFT' as const,postedBy:null,postedAt:null};const line={...adjustmentLine,resolvedBudgetId:null,resolvedVersionId:null,resolvedLineId:null,resolvedBasis:null,budgetCents:null};
    expect(parseAdjustmentEvidence({adjustment:draft,lines:[line],events:[adjustmentEvents[0]]},adjustmentScope,draft.id).lines[0].budgetCents).toBeNull();
    expect(parseAdjustmentEvidence({...adjustmentEvidence,lines:[{...adjustmentLine,exclusiveCents:'0',inclusiveCents:'0',budgetCents:'0'}]},adjustmentScope,adjustmentHeader.id).lines[0].budgetCents).toBe('0');
  });
  it('retains original reversed evidence and a posted correction as distinct lifecycle records',()=>{
    const reversed={...adjustmentHeader,status:'REVERSED' as const,reversedBy:'admin',reversedAt:'2026-09-10T03:00:00Z'};
    expect(parseAdjustmentEvidence({...adjustmentEvidence,adjustment:reversed,events:[...adjustmentEvents,{id:'reverse',type:'REVERSED',actor:'admin',at:reversed.reversedAt,details:{reason:'Correction',reversalAdjustmentId:'next'}}]},adjustmentScope,reversed.id).adjustment.status).toBe('REVERSED');
    expect(validAdjustmentHeader({...adjustmentHeader,reversalOf:'original'})).toBe(true);expect(validAdjustmentHeader({...reversed,reversalOf:'original'})).toBe(false);
  });
  it('requires the selected status on both register and detail reads',()=>{
    const scope={...adjustmentScope,status:'DRAFT' as const};expect(()=>parseAdjustmentRegister({...adjustmentReport,scope},scope,1)).toThrow();expect(()=>parseAdjustmentEvidence(adjustmentEvidence,scope,adjustmentHeader.id)).toThrow();
  });
  it.each([401,403,503])('preserves auth denial %s before any read',async status=>{
    authMock.mockResolvedValue({ok:false,response:new Response(null,{status})});expect((await GET(new Request('http://localhost'))).status).toBe(status);expect(queryMock).not.toHaveBeenCalled();expect(authMock).toHaveBeenCalledWith('budgeting','admin');
  });
  it.each(['periodId=invalid&currency=AUD',`periodId=${adjustmentScope.periodId}&currency=AU`,`periodId=${adjustmentScope.periodId}&currency=AUD&status=unknown`,`periodId=${adjustmentScope.periodId}&currency=AUD&page=0`,`periodId=${adjustmentScope.periodId}&currency=AUD&page=100001`,`periodId=${adjustmentScope.periodId}&currency=AUD&id=invalid`])('rejects invalid scope %s before SQL',async suffix=>{
    authMock.mockResolvedValue({ok:true,session:{organisationId:'org-a'}});expect((await GET(new Request('http://localhost?'+suffix))).status).toBe(400);expect(queryMock).not.toHaveBeenCalled();
  });
  it('uses bounded, session-tenant statements and returns no-store evidence or scoped 404',async()=>{
    authMock.mockResolvedValue({ok:true,session:{organisationId:'org-a'}});queryMock.mockResolvedValue([]);
    const response=await GET(new Request(`http://localhost?periodId=${adjustmentScope.periodId}&currency=AUD&id=${adjustmentHeader.id}&organisationId=foreign`));expect(response.status).toBe(404);expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(queryMock.mock.calls[0][1]).toEqual(['org-a',adjustmentScope.periodId,'AUD','',adjustmentHeader.id,'','']);
    const sql=queryMock.mock.calls[0][0];expect(sql).toContain('l.organisation_id=a.organisation_id');expect(sql).toContain('e.organisation_id=a.organisation_id');expect(sql).toContain('amount_exclusive_cents::text');expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('provides register count/page in one statement and orders lifecycle ties by their stages',async()=>{
    queryMock.mockResolvedValue([{count:0,adjustments:[]}]);expect((await listFinanceAdjustmentReview('org-a',adjustmentScope,2)).page).toBe(2);expect(queryMock.mock.calls[0][1]).toEqual(['org-a',adjustmentScope.periodId,'AUD','',25,'','']);expect(queryMock.mock.calls[0][0]).toContain('LIMIT 25 OFFSET $5');
    queryMock.mockResolvedValue([]);await getFinanceAdjustmentEvidence('org-a',adjustmentScope,adjustmentHeader.id);expect(queryMock.mock.calls[1][0]).toContain("WHEN 'CREATED' THEN 0 WHEN 'POSTED' THEN 1");
  });
});
