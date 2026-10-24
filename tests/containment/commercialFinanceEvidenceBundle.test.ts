import { describe,expect,it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { financeId,financeReadAt,reconciliationFixture,closeFixture } from '../fixtures/commercialFinanceEvidence';
import { parseReconciliationEvidence } from '@/lib/commercial/financeReconciliationEvidenceModel';
import { compareFinanceSnapshotTotals } from '@/lib/commercial/financeSnapshotComparison';
import { buildSnapshotComparisonDownload } from '@/lib/commercial/financeSnapshotComparisonExport';
import { buildReconciliationEvidenceDownload } from '@/lib/commercial/financeReconciliationEvidenceExport';
import { buildReconciliationHistoryDownload } from '@/lib/commercial/financeReconciliationHistoryExport';
import { buildCloseEvidenceDownload } from '@/lib/commercial/financeCloseEvidenceExport';
import { parseCloseEvidence } from '@/lib/commercial/financeCloseEvidenceModel';
import { followFinanceEvidenceFrom,selectFinanceEvidencePosition,type FinanceEvidenceTarget } from '@/lib/commercial/financeEvidenceNavigation';
import { reviewFinanceControls } from '@/lib/commercial/financeControlReview';
import { buildAdjustmentExport } from '@/lib/commercial/financeAdjustmentExport';
import { adjustmentScope,adjustmentHeader,adjustmentLine,adjustmentEvents,adjustmentReport,adjustmentEvidence } from '../fixtures/commercialAdjustmentReview';

describe('Finance evidence candidate integrity and portable evidence',()=>{
  it('exports all adjustment formats from accepted reads without changing saved facts',()=>{
    const input={scope:adjustmentScope,report:adjustmentReport,evidence:adjustmentEvidence,registerReadAt:financeReadAt,evidenceReadAt:financeReadAt,exportedAt:financeReadAt};const before=JSON.stringify(input);
    for(const kind of ['register','register-record','summary','lines','lifecycle','record','report'] as const){const file=buildAdjustmentExport(input,kind);expect(file.content.length).toBeGreaterThan(0);expect(file.filename).not.toContain('/');}
    const rows=parse(buildAdjustmentExport(input,'lines').content,{columns:true,bom:true});expect(rows[0]['Exclusive cents']).toBe("'9007199254740993");expect(rows[0]['Budget amount']).toBe("'90071992547409.93");
    expect(JSON.parse(buildAdjustmentExport(input,'record').content).evidence.adjustment.number).toBe('9007199254740993');expect(JSON.stringify(input)).toBe(before);
    expect(()=>buildAdjustmentExport({...input,evidenceReadAt:null},'report')).toThrow();expect(()=>buildAdjustmentExport({...input,report:{...adjustmentReport,totalCount:0,adjustments:[]}},'record')).toThrow();
  });
  it('leaves unresolved draft Budget values blank and preserves resolved zero',()=>{
    const header={...adjustmentHeader,status:'DRAFT' as const,postedAt:null,postedBy:null};const line={...adjustmentLine,resolvedBudgetId:null,resolvedVersionId:null,resolvedLineId:null,resolvedBasis:null,budgetCents:null};
    const input={scope:adjustmentScope,report:{...adjustmentReport,adjustments:[header]},evidence:{adjustment:header,lines:[line],events:[adjustmentEvents[0]]},registerReadAt:financeReadAt,evidenceReadAt:financeReadAt,exportedAt:financeReadAt};
    const rows=parse(buildAdjustmentExport(input,'lines').content,{columns:true,bom:true});expect(rows[0].Classification).toBe('UNRESOLVED');expect(rows[0]['Budget cents']).toBe('');expect(buildAdjustmentExport(input,'report').content).toContain('Unavailable — unresolved classification');
    const zero={...adjustmentLine,exclusiveCents:'0',taxCents:'0',inclusiveCents:'0',budgetCents:'0'};const complete={...input,report:adjustmentReport,evidence:{...adjustmentEvidence,lines:[zero]}};
    expect(parse(buildAdjustmentExport(complete,'lines').content,{columns:true,bom:true})[0]['Budget amount']).toBe("'0.00");
  });
  it('escapes hostile adjustment descriptions and event details in the printable report',()=>{
    const header={...adjustmentHeader,description:'<script>alert(1)</script>'};const input={scope:adjustmentScope,report:{...adjustmentReport,adjustments:[header]},evidence:{...adjustmentEvidence,adjustment:header,events:adjustmentEvents.map(event=>({...event,details:{...event.details,reason:'</pre><img src=x onerror=alert(1)>'}}))},registerReadAt:financeReadAt,evidenceReadAt:financeReadAt,exportedAt:financeReadAt};
    const html=buildAdjustmentExport(input,'report').content;expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;script&gt;');expect(html).toContain('Posting recorded');expect(html).toContain('POSTED');
  });
  it('accepts exact cents above Number precision and rejects aggregate corruption',()=>{
    const saved=reconciliationFixture();expect(parseReconciliationEvidence(saved,saved.scope,saved.header.id,'',1).header.sourceActualCents).toBe('9007199254740993');
    expect(()=>parseReconciliationEvidence({...saved,totals:{...saved.totals,varianceCents:'0'}},saved.scope,saved.header.id,'',1)).toThrow();
    expect(()=>parseReconciliationEvidence(saved,{...saved.scope,currency:'USD'},saved.header.id,'',1)).toThrow();
    expect(()=>parseReconciliationEvidence({...saved,events:[]},saved.scope,saved.header.id,'',1)).toThrow();
  });
  it('retains full totals/events when the selected page is empty',()=>{
    const saved={...reconciliationFixture(),page:2,items:[]};const file=buildReconciliationEvidenceDownload(saved,financeReadAt,financeReadAt,'json');const payload=JSON.parse(file.content);
    expect(payload.evidence.items).toEqual([]);expect(payload.evidence.totalCount).toBe(1);expect(payload.evidence.events).toHaveLength(1);expect(payload.evidence.header.varianceCents).toBe('10');
  });
  it('protects CSV numeric identities and formula text while retaining exact signed amounts',()=>{
    const saved=reconciliationFixture();saved.items[0].externalAccountCode=' \t=1+1';
    const rows=parse(buildReconciliationEvidenceDownload(saved,financeReadAt,financeReadAt,'csv').content,{columns:true,bom:true});
    expect(rows[0]['Budget account code']).toBe("'001");expect(rows[0]['External account code']).toBe("' \t=1+1");expect(rows[0]['Source Actual cents']).toBe("'9007199254740993");expect(rows[0]['Finance adjustment cents']).toBe("'-1");
  });
  it('escapes HTML and retains explicit page coverage, raw event details and original codes',()=>{
    const saved=reconciliationFixture();saved.header.notes='<img src=x onerror=alert(1)>';saved.events[0].details={reason:'</pre><script>alert(1)</script>'};
    const html=buildReconciliationEvidenceDownload(saved,financeReadAt,financeReadAt,'report').content;
    expect(html).not.toContain('<img');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('selected page 1');expect(html).toContain('VARIANCE');expect(html).toContain("default-src 'none'");
  });
  it('computes comparison-minus-baseline and never trusts supplied delta fields on export',()=>{
    const saved=reconciliationFixture(),base={header:saved.header,readAt:financeReadAt};const newer={header:{...saved.header,id:financeId(9),sourceActualCents:'9007199254740994',effectiveActualCents:'9007199254740993',varianceCents:'11',notes:''},readAt:financeReadAt};
    const comparison=compareFinanceSnapshotTotals(saved.scope,base,newer);expect(comparison.changes.sourceActualCents).toBe('1');expect(comparison.headerDifferences.find(row=>row.field==='notes')?.changed).toBe(true);
    const reversed=compareFinanceSnapshotTotals(saved.scope,newer,base);expect(reversed.changes.sourceActualCents).toBe('-1');
    const forged={...comparison,changes:{...comparison.changes,sourceActualCents:'12345'}};
    expect(JSON.parse(buildSnapshotComparisonDownload(forged,financeReadAt,'json').content).comparison.changes.sourceActualCents).toBe('1');
    const rows=parse(buildSnapshotComparisonDownload(comparison,financeReadAt,'header-csv').content,{columns:true,bom:true});const note=rows.find((row:Record<string,string>)=>row.Field==='Saved notes');expect(note['Baseline value state']).toBe('NOT_RECORDED');expect(note['Comparison value state']).toBe('EMPTY_TEXT');
    expect(()=>compareFinanceSnapshotTotals(saved.scope,base,base)).toThrow();expect(()=>compareFinanceSnapshotTotals({...saved.scope,source:'foreign'},base,newer)).toThrow();
  });
  it('does not interpret missing/unknown/empty close totals or year links as zero',()=>{
    const saved=closeFixture(),scope={kind:'period' as const,yearId:saved.yearId,periodId:saved.periodId};
    saved.controlTotals={basis:'future-format',retained:'value'};expect(buildCloseEvidenceDownload(saved,scope,financeReadAt,financeReadAt,'totals-csv').content).toContain('UNRECOGNISED_BASIS');
    saved.controlTotals={basis:'C7_8_SOURCE_ACTUAL',sourceActualByCurrency:[]};expect(buildCloseEvidenceDownload(saved,scope,financeReadAt,financeReadAt,'totals-csv').content).toContain('NO_CAPTURED_CURRENCY_ROWS');
    const year={...saved,kind:'year' as const,periodId:null,periodName:null,reconciliationStatus:null,controlTotals:{basis:'C7_9_YEAR_CLOSE',financialPeriodCount:0,currentPeriodCloseCount:0}};
    expect(buildCloseEvidenceDownload(year,{kind:'year',yearId:year.yearId,periodId:null},financeReadAt,financeReadAt,'links-csv').content).toContain('NOT_ASSESSED');
    expect(()=>parseCloseEvidence({...saved,current:false},scope,saved.id)).toThrow();
  });
  it('rejects duplicate currencies and inconsistent saved close arithmetic',()=>{
    const saved=closeFixture(),scope={kind:'period' as const,yearId:saved.yearId,periodId:saved.periodId};const row={currency:'AUD',lineCount:1,subtotalCents:'10',taxCents:'1',totalCents:'11'};
    expect(()=>parseCloseEvidence({...saved,controlTotals:{basis:'C7_8_SOURCE_ACTUAL',sourceActualByCurrency:[row,row]}},scope,saved.id)).toThrow();
    expect(()=>parseCloseEvidence({...saved,controlTotals:{basis:'C7_8_SOURCE_ACTUAL',sourceActualByCurrency:[{...row,totalCents:'12'}]}},scope,saved.id)).toThrow();
  });
  it('exports one history page without summing versions or adding missing items/events',()=>{
    const saved=reconciliationFixture(),history={scope:saved.scope,status:'' as const,page:1,pageSize:25 as const,totalCount:2,records:[saved.header,{...saved.header,id:financeId(9),latest:false}]};
    const html=buildReconciliationHistoryDownload(history,financeReadAt,financeReadAt,'report').content;expect(html).toContain('2 displayed saved headers');expect(html).toContain('must not be summed');
    const json=JSON.parse(buildReconciliationHistoryDownload(history,financeReadAt,financeReadAt,'json').content);expect(json.history.records).toHaveLength(2);expect(json.history.items).toBeUndefined();expect(json.history.totals).toBeUndefined();
  });
  it('retains forward references, collapses revisits and replaces only a new forward branch',()=>{
    const scope=reconciliationFixture().scope;const a:FinanceEvidenceTarget={kind:'reconciliation',id:financeId(3),scope};const b:FinanceEvidenceTarget={kind:'close',id:financeId(8),scope:{kind:'period',yearId:scope.yearId,periodId:scope.periodId}};const c:FinanceEvidenceTarget={...a,id:financeId(9)};
    const first=followFinanceEvidenceFrom({trail:[a],index:0},b);const back=selectFinanceEvidencePosition(first.trail,0);expect(back.trail).toHaveLength(2);
    expect(followFinanceEvidenceFrom(back,b).index).toBe(1);expect(followFinanceEvidenceFrom(first,a).trail).toHaveLength(2);expect(followFinanceEvidenceFrom(back,c).trail).toEqual([a,c]);
    expect(()=>followFinanceEvidenceFrom(back,{...a,scope:{...scope,periodId:financeId(99)}})).toThrow();
    expect(()=>selectFinanceEvidencePosition(first.trail,-1)).toThrow();
    const full=Array.from({length:16},(_,i)=>({...a,id:financeId(100+i)}));expect(()=>followFinanceEvidenceFrom({trail:full,index:15},c)).toThrow();expect(followFinanceEvidenceFrom({trail:full,index:0},c).trail).toHaveLength(2);
  });
  it('does not treat zero net variance, signed-off status or stale amounts as readiness',()=>{
    const scope=reconciliationFixture().scope;const input={available:true,year:{id:scope.yearId,name:'Year',status:'OPEN' as const},period:{id:scope.periodId,name:'October',status:'CLOSED' as const},source:scope.source,currency:'AUD',activeClose:{id:financeId(8),status:'CLOSED' as const},snapshots:[{id:financeId(3),financialYearId:scope.yearId,financialPeriodId:scope.periodId,sourceSystemId:scope.source,currency:'AUD',status:'SIGNED_OFF' as const,closeId:financeId(8),varianceCents:'0',unresolvedItemCount:1,snapshotAt:financeReadAt}]};
    expect(reviewFinanceControls(input).summary).toContain('unresolved');expect(reviewFinanceControls(input).next?.state).toBe('Needs investigation');expect(reviewFinanceControls({...input,available:false}).snapshot).toBeNull();
  });
});
