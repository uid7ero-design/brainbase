'use client';
import { useCallback, useRef, useState } from 'react';
import CalendarSetup from './CalendarSetup';
import DimensionSetup from './DimensionSetup';
import BudgetSetup from './BudgetSetup';
import { FinanceWorkflow } from '../../_components/FinanceWorkflow';
import styles from './page.module.css';
export default function FinanceSetup(){
  const [revision,setRevision]=useState(0);
  const revisionRef=useRef(0);
  const pending=useRef(new Set<string>());
  const [recoverySources,setRecoverySources]=useState<string[]>([]);
  // Keep the revision current even before React publishes the next render.
  const changed=useCallback(()=>{revisionRef.current++;setRevision(revisionRef.current);},[]);
  const report=useCallback((source:string,blocked:boolean)=>{
    if(pending.current.has(source)===blocked)return;
    if(blocked)pending.current.add(source);else pending.current.delete(source);
    setRecoverySources([...pending.current]);
  },[]);
  const calendarRecovery=useCallback((blocked:boolean)=>report('calendar',blocked),[report]);
  const accountRecovery=useCallback((blocked:boolean)=>report('accounts',blocked),[report]);
  const centreRecovery=useCallback((blocked:boolean)=>report('cost-centres',blocked),[report]);
  const isSetupCurrent=useCallback((loadedRevision:number)=>pending.current.size===0&&revisionRef.current===loadedRevision,[]);
  return <div className={styles.setup}><FinanceWorkflow current="setup" setupHint="Start with the calendar, accounts and cost centres below, then create and activate your Budget. Continue to External GL mappings for ledger comparison, Budget reporting for balances, or Finance controls for reconciliation and close."/><CalendarSetup onChange={changed} onRecoveryChange={calendarRecovery}/><DimensionSetup kind="accounts" title="Budget accounts" onChange={changed} onRecoveryChange={accountRecovery}/><DimensionSetup kind="cost-centres" title="Cost centres" onChange={changed} onRecoveryChange={centreRecovery}/><BudgetSetup revision={revision} recoverySources={recoverySources} isSetupCurrent={isSetupCurrent}/></div>;
}
