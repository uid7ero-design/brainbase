'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { Field,buttonProps,fieldControlClassName } from '@/components/ui/app';
import styles from './page.module.css';
import { budgetAmountToCents } from '@/lib/commercial/financeSetupDisplay';
import BudgetReview from './BudgetReview';
import DraftBudgetLineForm from './DraftBudgetLineForm';
import DraftBudgetAllocationForm from './DraftBudgetAllocationForm';
import BudgetActivationReview from './BudgetActivationReview';
type Dimension={id:string;code:string;active:boolean};
type Year={id:string;name:string;status:string;periods:{id:string;name:string}[]};
type Version={budget_id:string;version_id:string;name:string;financial_year_id:string;currency:string;tax_basis:string;periodisation_mode:string;version_number:number;status:string;can_edit_settings:boolean;lines:{id:string;budget_account_id:string;cost_centre_id:string;annual_budget_cents:string}[];allocations:{budget_line_id:string;financial_period_id:string;amount_cents:string}[];mappings:{cost_centre_id:string;budget_account_id:string}[]};
async function readSetup(){
  const responses=await Promise.all(['/api/commercial/budgeting/budgets','/api/commercial/budgeting/financial-periods','/api/commercial/budgeting/setup/accounts','/api/commercial/budgeting/setup/cost-centres'].map(url=>fetch(url)));
  if(responses.some(response=>!response.ok))throw new Error('Unable to load Budget setup.');
  const [budgets,calendar,accounts,centres]=await Promise.all(responses.map(response=>response.json()));
  return {versions:budgets.versions as Version[],years:calendar.years as Year[],accounts:accounts.records as Dimension[],centres:centres.records as Dimension[]};
}
function SelectField({label,name,options}:{label:string;name:string;options:{id:string;label:string}[]}){
  return <Field label={label} required>{control=><select {...control} name={name} required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>}</Field>;
}
export default function BudgetSetup({revision}:{revision:number}){
  const [data,setData]=useState<{versions:Version[];years:Year[];accounts:Dimension[];centres:Dimension[]}>({versions:[],years:[],accounts:[],centres:[]});
  const [versionId,setVersionId]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [editingLineId,setEditingLineId]=useState('');
  const [editingAllocationKey,setEditingAllocationKey]=useState<{lineId:string;periodId:string}|null>(null);
  const version=data.versions.find(row=>row.version_id===versionId);
  const editingLine=version?.lines.find(line=>line.id===editingLineId);
  const editingAllocation=version?.allocations.find(row=>row.budget_line_id===editingAllocationKey?.lineId&&row.financial_period_id===editingAllocationKey?.periodId);
  useEffect(()=>{
    let current=true;
    async function load(){try{const result=await readSetup();if(current){setData(result);setVersionId(id=>result.versions.some(row=>row.version_id===id)?id:result.versions[0]?.version_id??'');setError('');}}
      catch(failure){if(current)setError(failure instanceof Error?failure.message:'Unable to load Budget setup.');}finally{if(current)setLoading(false);}}
    void load();return()=>{current=false;};
  },[revision]);
  async function submit(event:FormEvent<HTMLFormElement>,action:'create'|'line'|'allocation'|'mapping'|'activate'|'settings'){
    event.preventDefault();if(loading||busy)return;
    const form=event.currentTarget,body:Record<string,unknown>={...Object.fromEntries(new FormData(form)),action};
    const target=version;
    setBusy(true);setError('');setMessage('');
    try{
      if(action==='line')body.annualBudgetCents=budgetAmountToCents(String(body.annualBudgetCents));
      if(action==='allocation')body.amountCents=budgetAmountToCents(String(body.amountCents));
      const endpoint=action==='create'?'/api/commercial/budgeting/budgets':`/api/commercial/budgeting/budgets/${target?.budget_id}/versions/${target?.version_id}/${action==='activate'?'activate':'setup'}`;
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Unable to save Budget setup.');
      const next=await readSetup();setData(next);if(action==='create')setVersionId(result.version.id);
      form.reset();if(action==='line'||action==='create'||action==='activate')setEditingLineId('');if(action==='allocation'||action==='create'||action==='activate')setEditingAllocationKey(null);setMessage(action==='activate'?'Budget version activated. Draft editing is now locked.':action==='settings'?'Budget settings saved. Existing amounts and allocations are unchanged.':'Budget setup saved.');
    }catch(failure){setError(failure instanceof Error?failure.message:'Unable to save Budget setup.');}finally{setBusy(false);}
  }
  const accountOptions=data.accounts.filter(row=>row.active).map(row=>({id:row.id,label:row.code}));
  const centreOptions=data.centres.filter(row=>row.active).map(row=>({id:row.id,label:row.code}));
  const accountCode=(id:string)=>data.accounts.find(row=>row.id===id)?.code??id;
  const centreCode=(id:string)=>data.centres.find(row=>row.id===id)?.code??id;
  const periods=data.years.find(year=>year.id===version?.financial_year_id)?.periods??[];
  return <section aria-labelledby="budget-setup-title" className={styles.panel}>
    <h2 id="budget-setup-title" style={{marginTop:0,fontSize:16}}>Budget setup</h2>
    <p style={{fontSize:13,color:'var(--text-secondary)'}}>Create a draft, add its lines and commitment mappings, then activate when ready. Enter amounts in the Budget currency with up to two decimal places, for example 6408.00. Periodised allocations must equal each line’s annual amount.</p>
    {error&&<p role="alert" style={{color:'var(--status-danger)'}}>{error}</p>}<p role="status">{loading?'Loading Budget setup…':message}</p>
    <form aria-label="Create Budget" onSubmit={event=>void submit(event,'create')}><fieldset disabled={loading||busy} className={styles.formGrid}>
      <Field label="Budget name" required>{control=><input {...control} name="name" required maxLength={100} className={fieldControlClassName}/>}</Field>
      <SelectField label="Budget financial year" name="financialYearId" options={data.years.filter(year=>year.status==='OPEN').map(year=>({id:year.id,label:year.name}))}/>
      <Field label="Budget currency" required>{control=><input {...control} name="currency" required pattern="[A-Za-z]{3}" maxLength={3} className={fieldControlClassName}/>}</Field>
      <SelectField label="Tax basis" name="taxBasis" options={[{id:'INCLUSIVE',label:'Tax inclusive'},{id:'EXCLUSIVE',label:'Tax exclusive'}]}/>
      <SelectField label="Periodisation" name="periodisationMode" options={[{id:'ANNUAL_ONLY',label:'Annual only'},{id:'PERIODISED',label:'Periodised'}]}/>
      <button {...buttonProps('primary')} type="submit">Create draft Budget</button>
    </fieldset></form>
    <Field label="Budget version">{control=><select {...control} className={fieldControlClassName} value={versionId} onChange={event=>{setVersionId(event.target.value);setEditingLineId('');setEditingAllocationKey(null);}} disabled={loading||busy}><option value="">Choose Budget</option>{data.versions.map(row=><option key={row.version_id} value={row.version_id}>{row.name} · {row.currency} · v{row.version_number} · {row.status}</option>)}</select>}</Field>
    {version?<div key={version.version_id} className={styles.budgetDetails}>
      <p className={styles.versionSummary}>{version.currency} · {version.tax_basis} · {version.periodisation_mode} · {version.status}</p>
      {version.can_edit_settings?<details className={styles.settingsDisclosure}>
        <summary>Edit draft settings</summary>
        <p>Name and tax basis apply to every draft of this Budget. Changing tax basis does not recalculate amounts. Currency, financial year and periodisation stay fixed.</p>
        <form key={`${version.version_id}:${version.name}:${version.tax_basis}`} aria-label="Draft Budget settings" onSubmit={event=>void submit(event,'settings')}><fieldset disabled={busy} className={styles.formGrid}>
          <Field label="Draft Budget name" required>{control=><input {...control} name="name" required maxLength={100} defaultValue={version.name} className={fieldControlClassName}/>}</Field>
          <Field label="Draft tax basis" required>{control=><select {...control} name="taxBasis" required defaultValue={version.tax_basis} className={fieldControlClassName}><option value="INCLUSIVE">Tax inclusive</option><option value="EXCLUSIVE">Tax exclusive</option></select>}</Field>
          <button {...buttonProps('secondary')} type="submit">Save draft settings</button>
        </fieldset></form>
      </details>:<p>Budget settings are locked after activation or when the financial year is closed.</p>}
      {version.status==='DRAFT'?<>
        <DraftBudgetLineForm key={`${version.version_id}:${editingLine?.id??'new'}`} currency={version.currency} busy={busy} line={editingLine} accounts={accountOptions} centres={centreOptions} accountCode={accountCode} centreCode={centreCode} onSubmit={event=>void submit(event,'line')} onCancel={()=>setEditingLineId('')}/>
        <form aria-label="Commitment mapping" onSubmit={event=>void submit(event,'mapping')}><fieldset disabled={busy} className={styles.formGrid}>
          <SelectField label="Mapping cost centre" name="costCentreId" options={centreOptions}/><SelectField label="Mapping account" name="budgetAccountId" options={accountOptions}/><button {...buttonProps('secondary')} type="submit">Save commitment mapping</button>
        </fieldset></form>
        <p>Each cost centre routes commitments to one Budget account. Saving a mapping for the same cost centre replaces its previous account.</p>
        {version.periodisation_mode==='PERIODISED'&&<DraftBudgetAllocationForm key={`${version.version_id}:${editingAllocation?.budget_line_id??'new'}:${editingAllocation?.financial_period_id??''}`} currency={version.currency} busy={busy} allocation={editingAllocation} lines={version.lines.map(line=>({id:line.id,label:accountCode(line.budget_account_id)+' / '+centreCode(line.cost_centre_id)}))} periods={periods.map(period=>({id:period.id,label:period.name}))} onSubmit={event=>void submit(event,'allocation')} onCancel={()=>setEditingAllocationKey(null)}/>}
      </>:<p>This version is read-only. Its existing lines, mappings and allocations remain available below.</p>}
      <BudgetReview currency={version.currency} periodised={version.periodisation_mode==='PERIODISED'} draft={version.status==='DRAFT'} lines={version.lines} allocations={version.allocations} periods={periods} accountCode={accountCode} centreCode={centreCode} busy={busy} onEditLine={id=>{setEditingLineId(id);setEditingAllocationKey(null);}} onEditAllocation={(lineId,periodId)=>{setEditingAllocationKey({lineId,periodId});setEditingLineId('');}}/>
      <p style={{fontSize:13}}>Commitment mappings: {version.mappings.length?version.mappings.map(mapping=>centreCode(mapping.cost_centre_id)+' → '+accountCode(mapping.budget_account_id)).join('; '):'None yet.'}</p>
      {version.status==='DRAFT'&&<>
        <BudgetActivationReview financialYearStatus={data.years.find(year=>year.id===version.financial_year_id)?.status} periodised={version.periodisation_mode==='PERIODISED'} lines={version.lines} mappings={version.mappings} allocations={version.allocations} periods={periods} accounts={data.accounts} centres={data.centres}/>
        <form className={styles.activationAction} aria-label="Activate Budget" onSubmit={event=>void submit(event,'activate')}><button {...buttonProps('primary')} disabled={busy||version.lines.length===0||version.mappings.length===0} type="submit">Activate Budget version</button></form>
      </>}
    </div>:!loading&&<p>No Budget versions yet. Create the first draft above.</p>}
  </section>;
}
