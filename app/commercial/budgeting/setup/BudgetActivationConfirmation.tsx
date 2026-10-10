'use client';
import { useEffect,useRef,type FormEvent } from 'react';
import { buttonProps } from '@/components/ui/app';
import { formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Props={
  version:{name:string;version_number:number;currency:string;tax_basis:string;periodisation_mode:string;lines:{annual_budget_cents:string}[];allocations:unknown[];mappings:unknown[]};
  yearName:string;reviewing:boolean;disabled:boolean;
  onReview:()=>void;onCancel:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;
};
export default function BudgetActivationConfirmation({version,yearName,reviewing,disabled,onReview,onCancel,onSubmit}:Props){
  const trigger=useRef<HTMLButtonElement>(null),review=useRef<HTMLElement>(null);
  useEffect(()=>{if(reviewing){review.current?.focus({preventScroll:true});review.current?.scrollIntoView({block:'start',behavior:'instant'});}},[reviewing]);
  const total=version.lines.reduce((sum,line)=>sum+BigInt(line.annual_budget_cents),BigInt(0)).toString();
  return <div className={styles.activationAction}>
    {!reviewing?<button ref={trigger} {...buttonProps('primary')} disabled={disabled||version.lines.length===0||version.mappings.length===0} type="button" onClick={onReview}>Activate Budget version</button>:<section ref={review} tabIndex={-1} aria-label="Budget activation confirmation" className={`${styles.navigationTarget} ${styles.activationConfirmation}`}>
      <h3>Confirm saved Budget activation</h3>
      <p>{version.name} · v{version.version_number} · {yearName}</p>
      <p>Annual total: <strong>{formatBudgetAmount(total,version.currency)}</strong></p>
      <p>{version.tax_basis==='INCLUSIVE'?'Tax inclusive':'Tax exclusive'} · {version.periodisation_mode==='PERIODISED'?'Periodised':'Annual only'}</p>
      <p>Saved lines: {version.lines.length} · Period allocations: {version.allocations.length} · Commitment mappings: {version.mappings.length}</p>
      <p>Only saved records are activated. Unsaved form values are excluded. Activation locks this version for editing. The server checks the latest records before activation.</p>
      <form aria-label="Activate Budget" onSubmit={onSubmit}>
        <div className={styles.reviewActions}>
          <button {...buttonProps('primary')} type="submit" disabled={disabled}>Confirm activation</button>
          <button {...buttonProps('secondary')} type="button" disabled={disabled} onClick={()=>{onCancel();requestAnimationFrame(()=>trigger.current?.focus());}}>Keep draft</button>
        </div>
      </form>
    </section>}
  </div>;
}
