'use client';
import { useState } from 'react';
import { buttonProps,Field,fieldControlClassName,tableStyles } from '@/components/ui/app';
import { financeReconciliationAction,type FinanceReconciliationControlStatus } from '@/lib/commercial/financeControlUi';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';

type ControlRecord={id:string;financialYearName:string;financialPeriodName:string;sourceSystemId:string;currency:string;status:FinanceReconciliationControlStatus;closeId:string|null;sourceActualCents:string;financeAdjustmentCents:string;brainbaseEffectiveActualCents:string;externalGlTotalCents:string;varianceCents:string;unresolvedItemCount:number;preparedAt:string;snapshotAt:string;reviewedAt:string|null;notes:string|null};
const measures=[['sourceActualCents','Source Actual'],['financeAdjustmentCents','Finance adjustments'],['brainbaseEffectiveActualCents','Effective Actual'],['externalGlTotalCents','External GL'],['varianceCents','Variance']] as const;
const statuses=['PREPARED','REVIEWED','SIGNED_OFF','STALE'] as const;
export function FinanceReconciliationControls<T extends ControlRecord>({records,activeCloseId,working,onInspect,onReview,onSignOff}:{records:T[];activeCloseId:string|null;working:boolean;onInspect:(row:T,trigger:HTMLButtonElement)=>void;onReview:(id:string)=>void;onSignOff:(id:string)=>void}){
  const [view,setView]=useState<'cards'|'table'>('cards'),[status,setStatus]=useState<''|FinanceReconciliationControlStatus>('');
  const visible=records.filter(row=>!status||row.status===status);
  function actions(row:T){
    const action=financeReconciliationAction(row.status,Boolean(activeCloseId));
    const explanation=working?'Saved controls are paused while loading, working or awaiting a confirmed refresh.'
      :action==='REVIEW'?'Review records a lifecycle action. Inspect the saved evidence before using it.'
      :action==='SIGN_OFF_BLOCKED'?'Sign off requires a loaded current period close. Review period-close controls; server rules still apply.'
      :action==='SIGN_OFF'?'Sign off is a separate action. The server checks the saved evidence and close linkage when requested.'
      :row.status==='STALE'?'This stale record is read only. Review changes and preparation controls for a fresh snapshot.'
      :'The saved record is marked signed off. Inspect its evidence and close linkage; this label does not establish current readiness.';
    return <div><div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="button" disabled={working} onClick={event=>onInspect(row,event.currentTarget)} {...buttonProps('secondary','sm')}>Inspect evidence</button>
      {action==='REVIEW'?<button type="button" disabled={working} onClick={()=>onReview(row.id)} {...buttonProps('secondary','sm')}>Review</button>:action==='SIGN_OFF'||action==='SIGN_OFF_BLOCKED'?<button type="button" disabled={working||action==='SIGN_OFF_BLOCKED'} onClick={()=>onSignOff(row.id)} {...buttonProps('primary','sm')}>Sign off</button>:<span style={{fontSize:12,color:'var(--text-muted)'}}>Read only</span>}
    </div><p style={{fontSize:12,color:'var(--text-muted)'}}>{explanation}</p></div>;
  }
  return <section id="finance-reconciliation-review" tabIndex={-1} aria-label="Latest reconciliation controls" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0,overflowWrap:'anywhere',scrollMarginTop:120}}>
    <h2 style={{fontSize:16,marginTop:0}}>Latest reconciliation control state</h2>
    <p style={{fontSize:12}}>One loaded latest snapshot per period, External GL source and currency. Versions and currencies stay separate. Zero variance and zero unresolved items do not establish approval; records remain visible regardless of those amounts.</p>
    {records.length?<>
      <Field label="Latest snapshot lifecycle status">{control=><select {...control} className={fieldControlClassName} value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="">All loaded statuses</option>{statuses.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select>}</Field>
      <p style={{fontSize:12}}>{visible.length} displayed of {records.length} loaded latest snapshots. This filter changes the loaded list only.</p>
      <div role="group" aria-label="Latest reconciliation display" style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" aria-pressed={view==='cards'} onClick={()=>setView('cards')} {...buttonProps('secondary','sm')}>Reconciliation cards</button><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')} {...buttonProps('secondary','sm')}>Detailed controls table</button></div>
      {view==='cards'?<div>{visible.length?visible.map(row=><article key={row.id} data-reconciliation-id={row.id} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0}}>
        <h3 style={{fontSize:14,marginTop:0}}>{row.sourceSystemId} · {row.currency} · {row.status}</h3><p style={{fontSize:12}}>{row.financialYearName} · {row.financialPeriodName} · Prepared {formatAustralianTimestamp(row.preparedAt)}.</p>
        <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>{measures.map(([field,label])=><div key={field}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{label}</dt><dd style={{margin:0}}>{formatMoneyCentsExact(row[field],row.currency)}</dd></div>)}</dl>
        <p style={{fontSize:12}}>Unresolved items: {row.unresolvedItemCount}. Net variance and unresolved-item count describe different issues.</p>
        {row.status==='SIGNED_OFF'?<p style={{fontSize:12}}>{activeCloseId&&row.closeId===activeCloseId?'Close reference matches the loaded current period close.':'Close reference does not match a loaded current period close. Inspect the saved linkage.'}</p>:null}
        <details style={{marginBlock:12}}><summary>Saved identity, timestamps and notes</summary><p>ID: {row.id} · Close: {row.closeId??'Not linked'}</p><p>Snapshot: {row.snapshotAt} · Prepared: {row.preparedAt} · Reviewed: {row.reviewedAt??'Not recorded'}</p><p style={{whiteSpace:'pre-wrap'}}>Notes: {row.notes===null?'Not supplied':row.notes===''?'Empty saved text':row.notes}</p></details>{actions(row)}
      </article>):<p>No loaded latest snapshots match this lifecycle filter.</p>}</div>:<div role="region" aria-label="Reconciliation control state" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:1250}}><thead><tr>{['Source','Currency','Status',...measures.map(([,label])=>label),'Unresolved','Prepared','Close','Action'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{visible.length?visible.map(row=><tr key={row.id} data-reconciliation-id={row.id}>
        <td>{row.sourceSystemId}</td><td>{row.currency}</td><td>{row.status}</td>{measures.map(([field])=><td key={field} className={tableStyles.num}>{formatMoneyCentsExact(row[field],row.currency)}</td>)}<td>{row.unresolvedItemCount}</td><td>{formatAustralianTimestamp(row.preparedAt)}</td><td>{row.closeId??'Not linked'}</td><td>{actions(row)}</td>
      </tr>):<tr><td colSpan={12}>No loaded latest snapshots match this lifecycle filter.</td></tr>}</tbody></table></div>}
    </>:<p>No reconciliation snapshots match the current scope.</p>}
  </section>;
}
