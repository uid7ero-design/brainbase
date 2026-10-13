'use client';
import { useEffect,useRef,useState } from 'react';
import { buttonProps,tableStyles,fieldControlClassName,Field } from '@/components/ui/app';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { parseAdjustmentRegister,parseAdjustmentEvidence,adjustmentLineTotals,type AdjustmentStatus,type AdjustmentRegister,type AdjustmentEvidence } from '@/lib/commercial/financeAdjustmentReviewModel';
const endpoint='/api/commercial/budgeting/finance-adjustments/review';
export function FinanceAdjustmentReview({periodId,currency,enabled,revision}:{periodId:string;currency:string;enabled:boolean;revision:number}){
  const [status,setStatus]=useState<''|AdjustmentStatus>('');
  const scope={periodId,currency,status};
  const baseKey=JSON.stringify(scope);
  const [paging,setPaging]=useState({key:'',page:1});
  const page=paging.key===baseKey?paging.page:1;
  const [reload,setReload]=useState(0);
  const key=JSON.stringify([baseKey,page,revision,reload,enabled]);
  const ready=enabled&&!!periodId&&/^[A-Z]{3}$/.test(currency);
  const [result,setResult]=useState<{key:string;report:AdjustmentRegister|null;error:string}>({key:'',report:null,error:''});
  const [selection,setSelection]=useState({key:'',id:''});
  const selectedId=selection.key===key?selection.id:'';
  const detailKey=JSON.stringify([key,selectedId]);
  const [detail,setDetail]=useState<{key:string;evidence:AdjustmentEvidence|null;error:string}>({key:'',evidence:null,error:''});
  const trigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{let current=true;if(!ready)return;
    async function read(){try{const query=new URLSearchParams({periodId,currency,status,page:String(page)});const response=await fetch(`${endpoint}?${query}`,{cache:'no-store'});if(!response.ok)throw new Error('Unable to load saved finance adjustments.');const data=await response.json();const report=parseAdjustmentRegister(data?.report,{periodId,currency,status},page);if(current)setResult({key,report,error:''});}
      catch(failure){if(current)setResult({key,report:null,error:failure instanceof Error?failure.message:'Unable to load saved finance adjustments.'});}}
    void read();return()=>{current=false;};
  },[ready,periodId,currency,status,page,key]);
  useEffect(()=>{let current=true;if(!ready||!selectedId)return;
    async function read(){try{const query=new URLSearchParams({periodId,currency,status,id:selectedId});const response=await fetch(`${endpoint}?${query}`,{cache:'no-store'});if(!response.ok)throw new Error('Unable to load this adjustment in the selected scope.');const data=await response.json();const evidence=parseAdjustmentEvidence(data?.evidence,{periodId,currency,status},selectedId);if(current)setDetail({key:detailKey,evidence,error:''});}
      catch(failure){if(current)setDetail({key:detailKey,evidence:null,error:failure instanceof Error?failure.message:'Unable to load saved adjustment evidence.'});}}
    void read();return()=>{current=false;};
  },[ready,periodId,currency,status,selectedId,detailKey]);
  const loading=ready&&result.key!==key;
  const report=ready&&result.key===key?result.report:null;
  const error=ready&&result.key===key?result.error:'';
  const evidence=report&&selectedId&&detail.key===detailKey?detail.evidence:null;
  const detailError=report&&selectedId&&detail.key===detailKey?detail.error:'';
  const totals=evidence?adjustmentLineTotals(evidence.lines):[];
  return <section aria-label="Finance adjustment review" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0}}>
    <h2 style={{fontSize:16,marginTop:0}}>Finance adjustments</h2>
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Review saved adjustment lines and lifecycle evidence for the selected period and currency. The External GL source selector does not filter adjustments. Draft, posted and reversed records remain separate; this review does not create, post or reverse an adjustment.</p>
    {!ready?<p>Choose a financial period and a three-letter currency, then wait for the finance controls to finish loading.</p>:<>
      <Field label="Adjustment status">{control=><select {...control} className={fieldControlClassName} value={status} disabled={loading} onChange={event=>setStatus(event.target.value as ''|AdjustmentStatus)}><option value="">All statuses</option>{(['DRAFT','POSTED','REVERSED']as const).map(value=><option key={value} value={value}>{value}</option>)}</select>}</Field>
      <button type="button" disabled={loading} onClick={()=>setReload(value=>value+1)} {...buttonProps('secondary','sm')}>Reload adjustment register</button>
      {loading?<p role="status">Loading saved adjustment register…</p>:null}
      {error?<p role="alert">{error} Reload the register before relying on this view.</p>:null}
      {report?<>
        <p style={{fontSize:12}}>Page {page} · {report.totalCount} matching adjustments · {currency}. Monetary amounts are shown in each saved adjustment; statuses are not combined into a new approval.</p>
        <div role="region" aria-label="Adjustment register table" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:900}}><thead><tr>{['Adjustment','Status','Type','Description','Reason','Created','Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
          {report.adjustments.length===0?<tr><td colSpan={7}>No finance adjustments match this scope.</td></tr>:report.adjustments.map(row=><tr key={row.id}><td>{row.number}</td><td>{row.status}</td><td>{row.type.replaceAll('_',' ')}</td><td>{row.description}</td><td>{row.reason}</td><td>{formatAustralianTimestamp(row.createdAt)}</td><td><button type="button" aria-expanded={selectedId===row.id} onClick={event=>{trigger.current=event.currentTarget;setSelection({key,id:row.id});}} {...buttonProps('secondary','sm')}>Review adjustment {row.number}</button></td></tr>)}
        </tbody></table></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button type="button" disabled={page===1} onClick={()=>setPaging({key:baseKey,page:page-1})} {...buttonProps('secondary','sm')}>Previous adjustment page</button><button type="button" disabled={page*25>=report.totalCount||page>=100000} onClick={()=>setPaging({key:baseKey,page:page+1})} {...buttonProps('secondary','sm')}>Next adjustment page</button>{page>1&&!report.adjustments.length?<button type="button" onClick={()=>setPaging({key:baseKey,page:1})} {...buttonProps('secondary','sm')}>First adjustment page</button>:null}</div>
      </>:null}
      {report&&selectedId&&detail.key!==detailKey?<p role="status">Loading saved adjustment evidence…</p>:null}
      {detailError?<p role="alert">{detailError} Reload the register and select the adjustment again.</p>:null}
      {evidence?<div role="region" aria-label="Saved adjustment evidence" style={{marginTop:18,overflowWrap:'anywhere'}}>
        <h3 style={{fontSize:14}}>Adjustment {evidence.adjustment.number} · {evidence.adjustment.status} · {evidence.adjustment.currency}</h3>
        {report?.adjustments.find(row=>row.id===selectedId)?.status!==evidence.adjustment.status?<p>Saved status changed since the register was read. Reload the register to update its status.</p>:null}
        <p>{evidence.adjustment.periodName} · {evidence.adjustment.description} · Reason: {evidence.adjustment.reason}</p>
        <p style={{fontSize:12}}>Source: {evidence.adjustment.sourceType??'Not recorded'} · {evidence.adjustment.sourceId??'Not recorded'} · Reversal of: {evidence.adjustment.reversalOf??'Not applicable'} · Reference period: {evidence.adjustment.referencePeriodId??'Not supplied'}. Related corrections can belong to another period.</p>
        <p style={{fontSize:12}}>Saved line totals: exclusive {formatMoneyCentsExact(totals[0],currency)} · tax {formatMoneyCentsExact(totals[1],currency)} · inclusive {formatMoneyCentsExact(totals[2],currency)}. Posting and classification are separate from these amounts.</p>
        <div role="region" aria-label="Adjustment line evidence" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:1100}}><thead><tr>{['Position','Account','Cost centre','Exclusive','Tax','Inclusive','Resolved Budget basis','Budget amount','Source bill line','Narrative'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{evidence.lines.length===0?<tr><td colSpan={10}>No saved adjustment lines.</td></tr>:evidence.lines.map(line=><tr key={line.id}><td>{line.position}</td><td>{line.accountCode} · {line.accountName}</td><td>{line.centreCode} · {line.centreName}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.exclusiveCents,currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.taxCents,currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.inclusiveCents,currency)}</td><td>{line.resolvedBasis??'Unresolved'}</td><td className={tableStyles.num}>{line.budgetCents===null?'Unavailable':formatMoneyCentsExact(line.budgetCents,currency)}<div style={{fontSize:11}}>{line.resolvedLineId??'No saved Budget line'}</div></td><td>{line.sourceBillLineId??'Not supplied'}</td><td>{line.narrative??'Not supplied'}</td></tr>)}</tbody></table></div>
        <h4>Lifecycle history</h4><div role="region" aria-label="Adjustment lifecycle history" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:750}}><thead><tr>{['Event','Actor','When','Reason','Related adjustment'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{evidence.events.map(event=><tr key={event.id}><td>{event.type}</td><td>{event.actor}</td><td>{formatAustralianTimestamp(event.at)}</td><td>{typeof event.details.reason==='string'?event.details.reason:'Not recorded'}</td><td>{typeof event.details.reversalOf==='string'?event.details.reversalOf:typeof event.details.reversalAdjustmentId==='string'?event.details.reversalAdjustmentId:typeof event.details.generatedByReversalOf==='string'?event.details.generatedByReversalOf:'Not applicable'}</td></tr>)}</tbody></table></div>
        <button type="button" onClick={()=>{setSelection({key:'',id:''});trigger.current?.focus();}} {...buttonProps('secondary','sm')}>Close adjustment evidence</button>
      </div>:null}
    </>}
  </section>;
}
