'use client';
import { useState } from 'react';
import CalendarSetup from './CalendarSetup';
import DimensionSetup from './DimensionSetup';
import BudgetSetup from './BudgetSetup';
import { FinanceWorkflow } from '../../_components/FinanceWorkflow';
import styles from './page.module.css';
export default function FinanceSetup(){
  const [revision,setRevision]=useState(0);
  const changed=()=>setRevision(value=>value+1);
  return <div className={styles.setup}><FinanceWorkflow current="setup" setupHint="Start with the calendar, accounts and cost centres below, then create and activate your Budget. Continue to External GL mappings for ledger comparison, Budget reporting for balances, or Finance controls for reconciliation and close."/><CalendarSetup onChange={changed}/><DimensionSetup kind="accounts" title="Budget accounts" onChange={changed}/><DimensionSetup kind="cost-centres" title="Cost centres" onChange={changed}/><BudgetSetup revision={revision}/></div>;
}
