'use client';
import { useState } from 'react';
import { buttonProps } from '@/components/ui/app';
import { financeEvidenceTargetKey,financeEvidenceTargetLabel,financeEvidenceTargetShortLabel,followFinanceEvidenceFrom,selectFinanceEvidencePosition,isFinanceEvidenceTarget,type FinanceEvidenceTarget } from '@/lib/commercial/financeEvidenceNavigation';
import { FinanceCloseEvidence } from './FinanceCloseEvidence';
import { FinanceReconciliationEvidence } from './FinanceReconciliationEvidence';

export function FinanceEvidenceExplorer({initial,onDismiss}:{initial:FinanceEvidenceTarget;onDismiss:()=>void}){
  const [navigation,setNavigation]=useState(()=>({trail:[initial],index:0,visit:0})),[error,setError]=useState('');
  const {trail,index,visit}=navigation,current=trail[index];
  if(!current||!isFinanceEvidenceTarget(current))return <section aria-label="Finance evidence inspection"><p role="alert">The selected evidence reference is incomplete. Return to the history and refresh saved controls.</p><button type="button" onClick={onDismiss} {...buttonProps('secondary','sm')}>Return to originating history</button></section>;
  function select(nextIndex:number){try{const position=selectFinanceEvidencePosition(trail,nextIndex);setError('');setNavigation({...position,visit:visit+1});}catch(failure){setError(failure instanceof Error?failure.message:'Unable to revisit this evidence reference.');}}
  function follow(next:FinanceEvidenceTarget){try{const position=followFinanceEvidenceFrom(navigation,next);setError('');setNavigation({...position,visit:visit+1});}catch(failure){setError(failure instanceof Error?failure.message:'Unable to follow this saved evidence reference.');}}
  function back(){if(index>0)select(index-1);else onDismiss();}
  const readerKey=JSON.stringify([financeEvidenceTargetKey(current),visit]);
  return <section aria-label="Finance evidence inspection" style={{minWidth:0}}>
    <nav aria-label="Finance evidence trail" style={{marginBlock:14,overflowWrap:'anywhere',border:'1px solid var(--border)',borderRadius:8,padding:14}}>
      <p role="status" style={{fontSize:12}}>Inspection step {index+1} of {trail.length} retained references · {financeEvidenceTargetShortLabel(current)}.</p>
      <p style={{fontSize:12,color:'var(--text-muted)'}}>Each visit reads the record again. Control selectors stay unchanged. Downloads cover the current record only. This trail records navigation references, not proof that a record loaded or was approved.</p>
      <div role="group" aria-label="Evidence navigation" style={{display:'flex',flexWrap:'wrap',gap:8}}>
        <button type="button" disabled={index===0} onClick={()=>select(index-1)} {...buttonProps('secondary','sm')}>Back to previous evidence</button>
        <button type="button" disabled={index===trail.length-1} onClick={()=>select(index+1)} {...buttonProps('secondary','sm')}>Forward to next evidence</button>
        <button type="button" onClick={onDismiss} {...buttonProps('secondary','sm')}>Return to originating history</button>
      </div>
      <ol style={{display:'flex',flexWrap:'wrap',gap:12,paddingLeft:20}}>{trail.slice(0,index+1).map((target,step)=><li key={financeEvidenceTargetKey(target)} style={{minWidth:0,maxWidth:'100%'}}>{step===index?<span aria-current="step">{financeEvidenceTargetShortLabel(target)}</span>:<button type="button" onClick={()=>select(step)} {...buttonProps('secondary','sm')} style={{maxWidth:'100%',whiteSpace:'normal',overflowWrap:'anywhere',textAlign:'left'}} aria-label={`Revisit step ${step+1}: ${financeEvidenceTargetLabel(target)}`}>{financeEvidenceTargetShortLabel(target)}</button>}</li>)}</ol>
      <details><summary>Current scope and retained record references</summary>
        <p style={{fontSize:12}}>Year ID: {current.scope.yearId} · Period ID: {current.scope.periodId??'Year-level inspection'}.</p>
        {current.kind==='reconciliation'?<p style={{fontSize:12}}>Inspected source: {current.scope.source} · Currency: {current.scope.currency}. These are the linked record’s scope, which may differ from the control selectors.</p>:<p style={{fontSize:12}}>This close inspection is not restricted to one source or currency.</p>}
        <p style={{fontSize:12}}>Following a new reference after going back replaces the forward branch. Up to 16 references are retained while this inspector is open; closing it clears the trail.</p>
        <ol>{trail.map((target,step)=><li key={financeEvidenceTargetKey(target)} style={{marginBlock:8}}>{step===index?<span aria-current="step">{financeEvidenceTargetLabel(target)} · Current reference</span>:<button type="button" onClick={()=>select(step)} {...buttonProps('secondary','sm')} style={{maxWidth:'100%',whiteSpace:'normal',overflowWrap:'anywhere',textAlign:'left'}} aria-label={`Revisit step ${step+1}: ${financeEvidenceTargetLabel(target)}`}>{financeEvidenceTargetLabel(target)}{step>index?' · Forward reference':''}</button>}</li>)}</ol>
      </details>
    </nav>
    {error?<p role="alert">{error}</p>:null}
    {current.kind==='close'?<FinanceCloseEvidence key={readerKey} id={current.id} scope={current.scope} onClose={back} backLabel={index>0?'Back to previous evidence':'Return to originating history'} onInspectReconciliation={follow}/>
      :<FinanceReconciliationEvidence key={readerKey} id={current.id} scope={current.scope} onClose={back} backLabel={index>0?'Back to previous evidence':'Return to originating history'} onInspectClose={follow}/>}
  </section>;
}
