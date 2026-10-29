import type { ReconciliationEvidence } from '@/lib/commercial/financeReconciliationEvidenceModel';
import type { CloseEvidence } from '@/lib/commercial/financeCloseEvidenceModel';
export const financeId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const financeReadAt='2026-10-24T09:00:00.000Z';
export function reconciliationFixture():ReconciliationEvidence{
  const scope={yearId:financeId(1),periodId:financeId(2),source:'ledger',currency:'AUD'};
  const amounts={sourceActualCents:'9007199254740993',financeAdjustmentCents:'-1',effectiveActualCents:'9007199254740992',externalGlCents:'9007199254740982',varianceCents:'10'};
  return {scope,filter:'',page:1,pageSize:25,totalCount:1,filteredCount:1,unresolvedCount:1,totals:{...amounts},
    header:{...scope,...amounts,id:financeId(3),yearName:'2026–2027',periodName:'October',status:'PREPARED',closeId:null,snapshotAt:financeReadAt,preparedAt:financeReadAt,preparedBy:'admin',reviewedBy:null,reviewedAt:null,notes:null,latest:true,unresolvedCount:1},
    items:[{...amounts,id:financeId(4),currency:'AUD',accountId:financeId(5),accountCode:'001',centreId:null,centreCode:null,accountMappingId:financeId(6),centreMappingId:null,externalAccountCode:'001',externalCentreCode:null,sourceCount:1,externalCount:1,outcome:'VARIANCE'}],
    events:[{id:financeId(7),type:'PREPARED',actor:'admin',at:financeReadAt,details:{}}]};
}
export function closeFixture():CloseEvidence{
  return {id:financeId(8),kind:'period',yearId:financeId(1),yearName:'2026–2027',periodId:financeId(2),periodName:'October',calendarStatus:'CLOSED',startsOn:'2026-10-01',endsOn:'2026-10-31',sequence:1,status:'CLOSED',closedBy:'admin',closedAt:financeReadAt,closeReason:null,invalidatedBy:null,invalidatedAt:null,invalidationReason:null,reconciliationStatus:'NOT_RECONCILED',controlTotals:{basis:'C7_8_SOURCE_ACTUAL',sourceActualByCurrency:[{currency:'AUD',lineCount:1,subtotalCents:'9007199254740993',taxCents:'0',totalCents:'9007199254740993'}]},current:true,laterCloseExists:false,linkedReconciliations:[]};
}
