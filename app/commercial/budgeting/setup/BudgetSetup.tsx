'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import { Field,buttonProps,fieldControlClassName } from '@/components/ui/app';
import styles from './page.module.css';
import { budgetAmountToCents,formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';
import BudgetReview from './BudgetReview';
import BudgetAllocationCalendar from './BudgetAllocationCalendar';
import DraftBudgetLineForm from './DraftBudgetLineForm';
import DraftBudgetAllocationForm from './DraftBudgetAllocationForm';
import BudgetActivationReview from './BudgetActivationReview';
import BudgetActivationConfirmation from './BudgetActivationConfirmation';
import DraftBudgetMappingForm from './DraftBudgetMappingForm';
import BudgetMappingReview from './BudgetMappingReview';
import BudgetSetupExports from './BudgetSetupExports';
import DraftBudgetLineRemoval from './DraftBudgetLineRemoval';
import DraftBudgetEntryRemoval from './DraftBudgetEntryRemoval';
type EntryRemoval={kind:'allocation';lineId:string;periodId:string}|{kind:'mapping';centreId:string};
type Dimension={id:string;code:string;active:boolean};
type Year={id:string;name:string;status:string;periods:{id:string;name:string;starts_on?:string;ends_on?:string}[]};
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
  const [needsReload,setNeedsReload]=useState(false);
  const [editorRevision,setEditorRevision]=useState(0);
  const operation=useRef(false),readSequence=useRef(0),pendingVersionId=useRef(''),recoveryRequired=useRef(false);
  function requireReload(){recoveryRequired.current=true;setNeedsReload(true);}
  const [reviewingActivation,setReviewingActivation]=useState(false);
  const activationLocked=busy||loading||needsReload;
  const locked=activationLocked||reviewingActivation;
  const [editingLineId,setEditingLineId]=useState('');
  const [removingLineId,setRemovingLineId]=useState('');
  const [removingEntry,setRemovingEntry]=useState<EntryRemoval|null>(null);
  function clearRemoval(){setRemovingLineId('');setRemovingEntry(null);}
  function startEntryRemoval(target:EntryRemoval){setRemovingLineId('');setRemovingEntry(target);setEditingLineId('');setEditingAllocationKey(null);setEditingMappingCentreId('');setError('');setMessage('');}
  function cancelRemoval(kind:'allocation'|'mapping'){clearRemoval();setError('');setMessage('Removal cancelled. Saved Budget records are unchanged.');returnToReview(kind==='mapping'?mappingReviewRef.current:amountReviewRef.current);}
  const [editingAllocationKey,setEditingAllocationKey]=useState<{lineId:string;periodId:string}|null>(null);
  const [editingMappingCentreId,setEditingMappingCentreId]=useState('');
  const amountReviewRef=useRef<HTMLElement>(null);
  const mappingReviewRef=useRef<HTMLElement>(null);
  function returnToReview(target:HTMLElement|null){
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'start',behavior:'instant'});
  }
  function cancelEditing(kind:'line'|'allocation'|'mapping'){
    if(kind==='line')setEditingLineId('');
    if(kind==='allocation')setEditingAllocationKey(null);
    if(kind==='mapping')setEditingMappingCentreId('');
    setError('');setMessage('Editing cancelled. Saved Budget records are unchanged.');
    returnToReview(kind==='mapping'?mappingReviewRef.current:amountReviewRef.current);
  }
  const version=data.versions.find(row=>row.version_id===versionId);
  const editingLine=version?.lines.find(line=>line.id===editingLineId);
  const removingLine=version?.lines.find(line=>line.id===removingLineId);
  const editingAllocation=version?.allocations.find(row=>row.budget_line_id===editingAllocationKey?.lineId&&row.financial_period_id===editingAllocationKey?.periodId);
  const removingAllocation=removingEntry?.kind==='allocation'?version?.allocations.find(row=>row.budget_line_id===removingEntry.lineId&&row.financial_period_id===removingEntry.periodId):undefined;
  const removingAllocationLine=version?.lines.find(row=>row.id===removingAllocation?.budget_line_id);
  const removingMapping=removingEntry?.kind==='mapping'?version?.mappings.find(row=>row.cost_centre_id===removingEntry.centreId):undefined;
  const editingMapping=version?.mappings.find(row=>row.cost_centre_id===editingMappingCentreId);
  useEffect(()=>{
    if(operation.current||recoveryRequired.current)return;
    let current=true;const sequence=++readSequence.current;setLoading(true);
    async function load(){try{const result=await readSetup();if(current&&sequence===readSequence.current){setData(result);setReviewingActivation(false);setNeedsReload(false);setVersionId(id=>result.versions.some(row=>row.version_id===id)?id:result.versions[0]?.version_id??'');setError('');}}
      catch(failure){if(current&&sequence===readSequence.current){requireReload();setError(failure instanceof Error?failure.message:'Unable to load Budget setup.');}}finally{if(current&&sequence===readSequence.current)setLoading(false);}}
    void load();return()=>{current=false;};
  },[revision]);
  useEffect(()=>{if(editorRevision>0)returnToReview(amountReviewRef.current);},[editorRevision]);
  async function reloadSaved(){
    if(operation.current||loading)return;
    operation.current=true;++readSequence.current;setBusy(true);setError('');setMessage('');
    try{
      const next=await readSetup();setData(next);
      const desiredVersion=pendingVersionId.current;
      setVersionId(id=>next.versions.some(row=>row.version_id===(desiredVersion||id))?(desiredVersion||id):next.versions[0]?.version_id??'');
      pendingVersionId.current='';setReviewingActivation(false);clearRemoval();setEditingLineId('');setEditingAllocationKey(null);setEditingMappingCentreId('');
      setEditorRevision(value=>value+1);recoveryRequired.current=false;setNeedsReload(false);setMessage('Saved Budget reloaded. Review the current records before making another change.');
    }catch(failure){requireReload();setError(failure instanceof Error?failure.message:'Unable to reload saved Budget.');}
    finally{operation.current=false;setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>,action:'create'|'line'|'allocation'|'mapping'|'activate'|'settings'|'remove-line'|'remove-allocation'|'remove-mapping'){
    event.preventDefault();if(operation.current||recoveryRequired.current||activationLocked||(action==='activate'?!reviewingActivation:reviewingActivation))return;
    operation.current=true;++readSequence.current;let outcome:'not-started'|'sent'|'confirmed'|'rejected'='not-started';
    const form=event.currentTarget,body:Record<string,unknown>={...Object.fromEntries(new FormData(form)),action};
    const target=version;
    const editingSavedRecord=(action==='mapping'&&Boolean(editingMapping))
      ||(action==='line'&&Boolean(editingLine))||(action==='allocation'&&Boolean(editingAllocationKey));
    const returnTarget=action.startsWith('remove-')?(action==='remove-mapping'?mappingReviewRef.current:amountReviewRef.current):editingSavedRecord?(action==='mapping'?mappingReviewRef.current:amountReviewRef.current):null;
    setBusy(true);setError('');setMessage('');
    try{
      if(action==='line')body.annualBudgetCents=budgetAmountToCents(String(body.annualBudgetCents));
      if(action==='allocation')body.amountCents=budgetAmountToCents(String(body.amountCents));
      const endpoint=action==='create'?'/api/commercial/budgeting/budgets':`/api/commercial/budgeting/budgets/${target?.budget_id}/versions/${target?.version_id}/${action==='activate'?'activate':'setup'}`;
      outcome='sent';
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(response.ok)outcome='confirmed';else if(response.status<500)outcome='rejected';
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Unable to save Budget setup.');
      if(action==='create')pendingVersionId.current=result.version.id;
      const next=await readSetup();setData(next);setReviewingActivation(false);if(action==='create')setVersionId(result.version.id);pendingVersionId.current='';
      form.reset();if(action==='mapping'||action==='create'||action==='activate')setEditingMappingCentreId('');if(action==='line'||action==='create'||action==='activate')setEditingLineId('');if(action==='allocation'||action==='create'||action==='activate')setEditingAllocationKey(null);setMessage(action==='activate'?'Budget version activated. Draft editing is now locked.':action==='settings'?'Budget settings saved. Existing amounts and allocations are unchanged.':'Budget setup saved.');
      if(action.startsWith('remove-')){clearRemoval();setEditingLineId('');setEditingAllocationKey(null);setEditingMappingCentreId('');setMessage(action==='remove-line'?'Draft line and its period allocations removed. Commitment mappings are unchanged.':action==='remove-allocation'?'Period allocation removed. Annual amounts and commitment mappings are unchanged.':'Commitment mapping removed. Budget lines and period allocations are unchanged.');}
      if(action==='create'||action==='activate')clearRemoval();
      returnToReview(returnTarget);
    }catch(failure){
      if(outcome==='confirmed'||outcome==='sent'){requireReload();setError(outcome==='confirmed'?'Your change was saved, but the refreshed Budget could not be loaded. Reload saved Budget before making another change.':'The save outcome could not be confirmed. Reload saved Budget before trying again.');}
      else {if(action==='activate')setReviewingActivation(false);setError(failure instanceof Error?failure.message:'Unable to save Budget setup.');}
    }finally{operation.current=false;setBusy(false);}
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
    <div className={styles.reloadControls} role="region" aria-label="Saved Budget reload">
      <button {...buttonProps('secondary')} type="button" disabled={busy||loading} onClick={()=>void reloadSaved()}>Reload saved Budget</button>
      <p>{needsReload?'The saved view needs a refresh. Editing, activation and exports are paused until reload succeeds.':'Reload restores saved records and clears unsaved edits. It does not save or repeat changes.'}</p>
    </div>
    <form key={editorRevision} aria-label="Create Budget" onSubmit={event=>void submit(event,'create')}><fieldset disabled={locked} className={styles.formGrid}>
      <Field label="Budget name" required>{control=><input {...control} name="name" required maxLength={100} className={fieldControlClassName}/>}</Field>
      <SelectField label="Budget financial year" name="financialYearId" options={data.years.filter(year=>year.status==='OPEN').map(year=>({id:year.id,label:year.name}))}/>
      <Field label="Budget currency" required>{control=><input {...control} name="currency" required pattern="[A-Za-z]{3}" maxLength={3} className={fieldControlClassName}/>}</Field>
      <SelectField label="Tax basis" name="taxBasis" options={[{id:'INCLUSIVE',label:'Tax inclusive'},{id:'EXCLUSIVE',label:'Tax exclusive'}]}/>
      <SelectField label="Periodisation" name="periodisationMode" options={[{id:'ANNUAL_ONLY',label:'Annual only'},{id:'PERIODISED',label:'Periodised'}]}/>
      <button {...buttonProps('primary')} type="submit">Create draft Budget</button>
    </fieldset></form>
    <Field label="Budget version">{control=><select {...control} className={fieldControlClassName} value={versionId} onChange={event=>{setVersionId(event.target.value);setReviewingActivation(false);clearRemoval();setEditingLineId('');setEditingAllocationKey(null);setEditingMappingCentreId('');}} disabled={locked}><option value="">Choose Budget</option>{data.versions.map(row=><option key={row.version_id} value={row.version_id}>{row.name} · {row.currency} · v{row.version_number} · {row.status}</option>)}</select>}</Field>
    {version?<div key={`${version.version_id}:${editorRevision}`} className={styles.budgetDetails}>
      <p className={styles.versionSummary}>{version.currency} · {version.tax_basis} · {version.periodisation_mode} · {version.status}</p>
      {version.can_edit_settings?<details className={styles.settingsDisclosure}>
        <summary>Edit draft settings</summary>
        <p>Name and tax basis apply to every draft of this Budget. Changing tax basis does not recalculate amounts. Currency, financial year and periodisation stay fixed.</p>
        <form key={`${version.version_id}:${version.name}:${version.tax_basis}`} aria-label="Draft Budget settings" onSubmit={event=>void submit(event,'settings')}><fieldset disabled={locked} className={styles.formGrid}>
          <Field label="Draft Budget name" required>{control=><input {...control} name="name" required maxLength={100} defaultValue={version.name} className={fieldControlClassName}/>}</Field>
          <Field label="Draft tax basis" required>{control=><select {...control} name="taxBasis" required defaultValue={version.tax_basis} className={fieldControlClassName}><option value="INCLUSIVE">Tax inclusive</option><option value="EXCLUSIVE">Tax exclusive</option></select>}</Field>
          <button {...buttonProps('secondary')} type="submit">Save draft settings</button>
        </fieldset></form>
      </details>:<p>Budget settings are locked after activation or when the financial year is closed.</p>}
      {version.status==='DRAFT'?<>
        <section id="budget-line-setup" aria-label="Budget line setup" tabIndex={-1} className={styles.navigationTarget}>
          <DraftBudgetLineForm key={`${version.version_id}:${editingLine?.id??'new'}`} currency={version.currency} busy={locked} line={editingLine} accounts={accountOptions} centres={centreOptions} accountCode={accountCode} centreCode={centreCode} onSubmit={event=>void submit(event,'line')} onCancel={()=>cancelEditing('line')}/>
        </section>
        <section id="budget-commitment-mapping" aria-label="Commitment mapping setup" tabIndex={-1} className={styles.mappingSetup}>
          <h3>Commitment mapping setup</h3>
          <DraftBudgetMappingForm key={`${version.version_id}:${editingMapping?.cost_centre_id??'new'}`} busy={locked} mapping={editingMapping} accounts={data.accounts} centres={data.centres} onSubmit={event=>void submit(event,'mapping')} onCancel={()=>cancelEditing('mapping')}/>
        </section>
        {version.periodisation_mode==='PERIODISED'&&<DraftBudgetAllocationForm key={`${version.version_id}:${editingAllocationKey?.lineId??'new'}:${editingAllocationKey?.periodId??''}`} selection={editingAllocationKey&&!editingAllocation?{budget_line_id:editingAllocationKey.lineId,financial_period_id:editingAllocationKey.periodId}:undefined} currency={version.currency} busy={locked} allocation={editingAllocation} lines={version.lines.map(line=>({id:line.id,label:accountCode(line.budget_account_id)+' / '+centreCode(line.cost_centre_id)}))} periods={periods.map(period=>({id:period.id,label:period.name}))} onSubmit={event=>void submit(event,'allocation')} onCancel={()=>cancelEditing('allocation')}/>}
      </>:<p>This version is read-only. Its existing lines, mappings and allocations remain available below.</p>}
      <section ref={amountReviewRef} id="budget-allocation-review" aria-label="Budget amount review" tabIndex={-1} className={styles.navigationTarget}>
        <BudgetReview currency={version.currency} periodised={version.periodisation_mode==='PERIODISED'} draft={version.status==='DRAFT'} lines={version.lines} allocations={version.allocations} periods={periods} accountCode={accountCode} centreCode={centreCode} busy={locked} onRemoveAllocation={(lineId,periodId)=>startEntryRemoval({kind:'allocation',lineId,periodId})} onRemoveLine={id=>{setRemovingEntry(null);setRemovingLineId(id);setEditingLineId('');setEditingAllocationKey(null);setEditingMappingCentreId('');setError('');setMessage('');}} onEditLine={id=>{clearRemoval();setEditingLineId(id);setEditingAllocationKey(null);setEditingMappingCentreId('');}} onEditAllocation={(lineId,periodId)=>{clearRemoval();setEditingAllocationKey({lineId,periodId});setEditingLineId('');setEditingMappingCentreId('');}}/>
        {version.periodisation_mode==='PERIODISED'&&<BudgetAllocationCalendar currency={version.currency} draft={version.status==='DRAFT'} busy={locked} lines={version.lines} allocations={version.allocations} periods={periods} accountCode={accountCode} centreCode={centreCode} onSelect={(lineId,periodId)=>{clearRemoval();setEditingAllocationKey({lineId,periodId});setEditingLineId('');setEditingMappingCentreId('');}}/>}
        {version.status==='DRAFT'&&removingLine&&<DraftBudgetLineRemoval key={removingLine.id} line={removingLine} account={accountCode(removingLine.budget_account_id)} centre={centreCode(removingLine.cost_centre_id)} currency={version.currency} allocationCount={version.allocations.filter(row=>row.budget_line_id===removingLine.id).length} busy={locked} onSubmit={event=>void submit(event,'remove-line')} onCancel={()=>{setRemovingLineId('');setError('');setMessage('Removal cancelled. Saved Budget records are unchanged.');returnToReview(amountReviewRef.current);}}/>}
        {version.status==='DRAFT'&&removingAllocation&&removingAllocationLine&&<DraftBudgetEntryRemoval key={`${removingAllocation.budget_line_id}:${removingAllocation.financial_period_id}`} kind="allocation" identity={{budgetLineId:removingAllocation.budget_line_id,financialPeriodId:removingAllocation.financial_period_id}} summary={`${accountCode(removingAllocationLine.budget_account_id)} / ${centreCode(removingAllocationLine.cost_centre_id)} / ${periods.find(row=>row.id===removingAllocation.financial_period_id)?.name??'Unavailable period'} · ${formatBudgetAmount(removingAllocation.amount_cents,version.currency)}`} busy={locked} onSubmit={event=>void submit(event,'remove-allocation')} onCancel={()=>cancelRemoval('allocation')}/>}
      </section>
      <section ref={mappingReviewRef} aria-label="Commitment mapping review" tabIndex={-1} className={styles.navigationTarget}>
        <BudgetMappingReview mappings={version.mappings} accounts={data.accounts} centres={data.centres} draft={version.status==='DRAFT'} busy={locked} onRemove={centreId=>startEntryRemoval({kind:'mapping',centreId})} onEdit={centreId=>{clearRemoval();setEditingMappingCentreId(centreId);setEditingLineId('');setEditingAllocationKey(null);}}/>
        {version.status==='DRAFT'&&removingMapping&&<DraftBudgetEntryRemoval key={removingMapping.cost_centre_id} kind="mapping" identity={{costCentreId:removingMapping.cost_centre_id}} summary={`${centreCode(removingMapping.cost_centre_id)} → ${accountCode(removingMapping.budget_account_id)}`} busy={locked} onSubmit={event=>void submit(event,'remove-mapping')} onCancel={()=>cancelRemoval('mapping')}/>}
      </section>
      <BudgetSetupExports input={{version,year:data.years.find(year=>year.id===version.financial_year_id),accounts:data.accounts,centres:data.centres}} busy={locked}/>
      {version.status==='DRAFT'&&<>
        <BudgetActivationReview setupNavigation mappingFormId="budget-commitment-mapping" financialYearStatus={data.years.find(year=>year.id===version.financial_year_id)?.status} periodised={version.periodisation_mode==='PERIODISED'} lines={version.lines} mappings={version.mappings} allocations={version.allocations} periods={periods} accounts={data.accounts} centres={data.centres}/>
        <BudgetActivationConfirmation version={version} yearName={data.years.find(year=>year.id===version.financial_year_id)?.name??'Unavailable financial year'} reviewing={reviewingActivation} disabled={activationLocked} onReview={()=>{clearRemoval();setReviewingActivation(true);setError('');setMessage('');}} onCancel={()=>{setReviewingActivation(false);setMessage('Activation cancelled. The saved Budget remains a draft.');}} onSubmit={event=>void submit(event,'activate')}/>
      </>}
    </div>:!loading&&!needsReload&&<p>No Budget versions yet. Create the first draft above.</p>}
  </section>;
}
