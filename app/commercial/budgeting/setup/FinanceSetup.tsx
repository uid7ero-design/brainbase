'use client';
import { useState } from 'react';
import CalendarSetup from './CalendarSetup';
import DimensionSetup from './DimensionSetup';
import BudgetSetup from './BudgetSetup';
export default function FinanceSetup(){
  const [revision,setRevision]=useState(0);
  const changed=()=>setRevision(value=>value+1);
  return <div style={{maxWidth:1100}}><CalendarSetup onChange={changed}/><DimensionSetup kind="accounts" title="Budget accounts" onChange={changed}/><DimensionSetup kind="cost-centres" title="Cost centres" onChange={changed}/><BudgetSetup revision={revision}/></div>;
}
