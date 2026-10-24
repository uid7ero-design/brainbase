'use client';
import { useState } from 'react';
import { buttonProps,Field,fieldControlClassName,tableStyles } from '@/components/ui/app';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { describeYearCloseHistoryTotals } from '@/lib/commercial/financeCloseHistoryDisplay';

type CloseHistoryRecord={id:string;close_sequence:number;status:'CLOSED'|'INVALIDATED';closed_at:string;close_reason:string|null;invalidated_at:string|null;invalidation_reason:string|null;reconciliation_status?:string;control_totals?:Record<string,unknown>};
const savedText=(value:string|null)=>value===null?'Not supplied':value===''?'Empty saved text':value;
export function FinanceCloseHistory({kind,records,currentCloseId=null,working,onInspect}:{kind:'year'|'period';records:CloseHistoryRecord[];currentCloseId?:string|null;working:boolean;onInspect:(id:string,trigger:HTMLButtonElement)=>void}){
  const [view,setView]=useState<'cards'|'table'>('cards'),[status,setStatus]=useState<''|'CLOSED'|'INVALIDATED'>('');
  const visible=records.filter(row=>!status||row.status===status);
  function inspect(row:CloseHistoryRecord){return <button type="button" disabled={working} onClick={event=>onInspect(row.id,event.currentTarget)} {...buttonProps('secondary','sm')}>Inspect {kind} close {row.close_sequence}</button>;}
  return <section aria-label={`${kind==='year'?'Year':'Period'}-close history`} style={{marginTop:18,minWidth:0,overflowWrap:'anywhere'}}>
    <h3 style={{fontSize:14}}>Durable {kind}-close history</h3>
    <p style={{fontSize:12}}>Saved close records are separate. Filtering changes this loaded list only. Calendar/current-close labels and reconciliation status describe the saved controls read; captured totals describe the close.</p>
    {records.length?<>
      <Field label={`${kind==='year'?'Year':'Period'} close history status`}>{control=><select {...control} className={fieldControlClassName} value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="">All loaded close records</option><option value="CLOSED">Closed records</option><option value="INVALIDATED">Invalidated records</option></select>}</Field>
      <p style={{fontSize:12}}>{visible.length} displayed of {records.length} loaded close records. Other calendar scopes are outside this history.</p>
      {currentCloseId&&!visible.some(row=>row.id===currentCloseId)?<p style={{fontSize:12}}>The loaded current close is outside this filtered list.</p>:null}
      <div role="group" aria-label={`${kind} close history display`} style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" aria-pressed={view==='cards'} onClick={()=>setView('cards')} {...buttonProps('secondary','sm')}>Close history cards</button><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')} {...buttonProps('secondary','sm')}>Detailed history table</button></div>
      {view==='cards'?<div>{visible.length?visible.map(row=><article key={row.id} {...(kind==='year'?{'data-year-close-id':row.id}:{'data-close-id':row.id})} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0}}>
        <h4 style={{fontSize:14,marginTop:0}}>Close {row.close_sequence} · {row.status}{currentCloseId===row.id?' · Current close at read':''}</h4><p style={{fontSize:12}}>Closed {formatAustralianTimestamp(row.closed_at)}</p><p style={{fontSize:12,whiteSpace:'pre-wrap'}}>Reason: {savedText(row.close_reason)}</p>
        {kind==='year'?<p style={{fontSize:12}}>{describeYearCloseHistoryTotals(row.control_totals)} These saved counts do not assess current readiness.</p>:<p style={{fontSize:12}}>Reconciliation status at read: {row.reconciliation_status??'Not supplied'}. Inspect linked evidence for the saved record.</p>}
        {row.invalidated_at?<p style={{fontSize:12,whiteSpace:'pre-wrap'}}>Invalidated {formatAustralianTimestamp(row.invalidated_at)} · {savedText(row.invalidation_reason)}</p>:null}
        <details style={{marginBlock:10}}><summary>Saved identity and original timestamps</summary><p>ID: {row.id}</p><p>Closed: {row.closed_at} · Invalidated: {row.invalidated_at??'Not invalidated'}</p>{row.control_totals?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(row.control_totals,null,2)}</pre>:<p>Inspect evidence for the complete captured control totals.</p>}</details>{inspect(row)}
      </article>):<p>No loaded close records match this status filter.</p>}</div>:<div role="region" aria-label={`${kind} close history table`} tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:850}}><thead><tr>{['Sequence','Status','Closed','Reason',kind==='year'?'Captured totals':'Reconciliation at read','Invalidation','Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{visible.length?visible.map(row=><tr key={row.id} {...(kind==='year'?{'data-year-close-id':row.id}:{'data-close-id':row.id})}>
        <td>{row.close_sequence}</td><td>{row.status}{currentCloseId===row.id?<div>Current close at read</div>:null}</td><td>{formatAustralianTimestamp(row.closed_at)}</td><td style={{whiteSpace:'pre-wrap'}}>{savedText(row.close_reason)}</td><td>{kind==='year'?describeYearCloseHistoryTotals(row.control_totals):row.reconciliation_status??'Not supplied'}</td><td style={{whiteSpace:'pre-wrap'}}>{row.invalidated_at?<>{formatAustralianTimestamp(row.invalidated_at)} · {savedText(row.invalidation_reason)}</>:'Not invalidated'}</td><td>{inspect(row)}</td>
      </tr>):<tr><td colSpan={7}>No loaded close records match this status filter.</td></tr>}</tbody></table></div>}
    </>:<p>No close history for this financial {kind}.</p>}
  </section>;
}
