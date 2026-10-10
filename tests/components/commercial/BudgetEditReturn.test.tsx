import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetSetup from '@/app/commercial/budgeting/setup/BudgetSetup';

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scroll = vi.fn();
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll }));
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cases = [
  { kind: 'line', edit: 'Edit SOFTWARE / GENERAL', field: 'Annual amount (AUD)', value: '120.00', update: 'Update line', cancel: 'Cancel editing', form: 'Budget line', review: 'Budget amount review' },
  { kind: 'allocation', edit: 'Edit allocation SOFTWARE / GENERAL / QTR 1', field: 'Period amount (AUD)', value: '90.00', update: 'Update allocation', cancel: 'Cancel allocation editing', form: 'Period allocation', review: 'Budget amount review' },
  { kind: 'mapping', edit: 'Edit mapping GENERAL', field: 'Mapping account', value: 'alternate', update: 'Update mapping', cancel: 'Cancel mapping editing', form: 'Commitment mapping', review: 'Commitment mapping review' },
] as const;
const initial = {
  budget_id: 'budget', version_id: 'version', name: 'Draft', financial_year_id: 'year', currency: 'AUD', tax_basis: 'EXCLUSIVE', periodisation_mode: 'PERIODISED', version_number: 1, status: 'DRAFT', can_edit_settings: true,
  lines: [{ id: 'line', budget_account_id: 'account', cost_centre_id: 'centre', annual_budget_cents: '10000' }],
  allocations: [{ budget_line_id: 'line', financial_period_id: 'period', amount_cents: '10000' }],
  mappings: [{ cost_centre_id: 'centre', budget_account_id: 'account' }],
};
let version = structuredClone(initial);
let failSave = false;
let failRead=false,loseResponse=false;
let postGate:Promise<void>|null=null;
let extraVersions:typeof initial[]=[];
const mutations: Record<string, string>[] = [];
beforeEach(() => {
  version = structuredClone(initial); failSave = false;failRead=false;loseResponse=false;postGate=null;extraVersions=[]; mutations.length = 0; scroll.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body)); mutations.push(body);
      if(postGate)await postGate;
      if (failSave) return Response.json({ error: 'Save rejected. Draft remains unchanged.' }, { status: 409 });
      if(body.action==='create'){const created={...structuredClone(initial),version_id:'created-version',budget_id:'created-budget',name:body.name};extraVersions.push(created);return Response.json({version:{id:created.version_id}});}
      if(body.action==='activate')version.status='ACTIVE';
      if (body.action === 'remove-allocation') version.allocations = [];
      if (body.action === 'remove-mapping') version.mappings = [];
      if (body.action === 'remove-line') { version.lines = []; version.allocations = []; }
      if (body.action === 'line') version.lines[0].annual_budget_cents = body.annualBudgetCents;
      if (body.action === 'allocation') {const saved=version.allocations.find(row=>row.budget_line_id===body.budgetLineId&&row.financial_period_id===body.financialPeriodId);if(saved)saved.amount_cents=body.amountCents;else version.allocations.push({budget_line_id:body.budgetLineId,financial_period_id:body.financialPeriodId,amount_cents:body.amountCents});}
      if (body.action === 'mapping') version.mappings[0].budget_account_id = body.budgetAccountId;
      if(loseResponse)throw new Error('Response lost');
      return Response.json({});
    }
    if(failRead)throw new Error('Read unavailable');
    if (url.endsWith('/budgets')) return Response.json({ versions: [version,...extraVersions] });
    if (url.endsWith('/financial-periods')) return Response.json({ years: [{ id: 'year', name: 'FY', status: 'OPEN', periods: [{ id: 'period', name: 'QTR 1' }] }] });
    if (url.endsWith('/accounts')) return Response.json({ records: [{ id: 'account', code: 'SOFTWARE', active: true }, { id: 'alternate', code: 'HOSTING', active: true }] });
    if (url.endsWith('/cost-centres')) return Response.json({ records: [{ id: 'centre', code: 'GENERAL', active: true }] });
    throw new Error('Unexpected setup request');
  }));
});

describe('Saved Budget editor return navigation', () => {
  it.each([false,true])('requires read-only recovery when post outcome is uncertain=%s',async lost=>{
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    const editor=within(screen.getByRole('form',{name:'Budget line'}));
    fireEvent.change(editor.getByLabelText('Annual amount (AUD)',{exact:false}),{target:{value:'123.45'}});
    failRead=true;loseResponse=lost;
    fireEvent.click(editor.getByRole('button',{name:'Update line'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(lost?'save outcome could not be confirmed':'Your change was saved');
    expect(version.lines[0].annual_budget_cents).toBe('12345');
    expect(editor.getByLabelText('Annual amount (AUD)',{exact:false})).toHaveValue('123.45');
    expect(editor.getByRole('button',{name:'Update line'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Export Budget lines CSV'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeDisabled();
    fireEvent.submit(screen.getByRole('form',{name:'Budget line'}));
    expect(mutations).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Read unavailable'));
    expect(mutations).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Export Budget lines CSV'})).toBeDisabled();
    failRead=false;
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved Budget reloaded.'));
    expect(screen.getByRole('region',{name:'Budget amount review'})).toHaveFocus();
    expect(screen.getByRole('region',{name:'Budget amount review'})).toHaveTextContent('AUD 123.45');
    expect(screen.getByRole('button',{name:'Export Budget lines CSV'})).toBeEnabled();
    expect(screen.queryByRole('button',{name:'Cancel editing'})).not.toBeInTheDocument();
    expect(mutations).toHaveLength(1);
  });
  it('selects the newly created draft after a failed readback and reload',async()=>{
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    const form=screen.getByRole('form',{name:'Create Budget'}),fields=within(form);
    fireEvent.change(fields.getByLabelText('Budget name',{exact:false}),{target:{value:'Recovered draft'}});
    fireEvent.change(fields.getByLabelText('Budget financial year',{exact:false}),{target:{value:'year'}});
    fireEvent.change(fields.getByLabelText('Budget currency',{exact:false}),{target:{value:'AUD'}});
    fireEvent.change(fields.getByLabelText('Tax basis',{exact:false}),{target:{value:'EXCLUSIVE'}});
    fireEvent.change(fields.getByLabelText('Periodisation',{exact:false}),{target:{value:'PERIODISED'}});
    failRead=true;fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your change was saved');
    failRead=false;fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByLabelText('Budget version',{exact:true})).toHaveValue('created-version'));
    expect(mutations).toHaveLength(1);expect(extraVersions).toHaveLength(1);
  });
  it('reviews saved values, locks editors, cancels without mutation and confirms once',async()=>{
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    fireEvent.change(screen.getByLabelText('Annual amount (AUD)',{exact:false}),{target:{value:'888.00'}});
    fireEvent.click(screen.getByRole('button',{name:'Activate Budget version'}));
    const review=screen.getByRole('region',{name:'Budget activation confirmation'});
    expect(review).toHaveFocus();expect(review).toHaveTextContent('Draft · v1 · FY');
    expect(review).toHaveTextContent('AUD 100.00');expect(review).not.toHaveTextContent('888.00');
    expect(review).toHaveTextContent('Tax exclusive · Periodised');
    expect(review).toHaveTextContent('Saved lines: 1 · Period allocations: 1 · Commitment mappings: 1');
    expect(screen.getByRole('button',{name:'Update line'})).toBeDisabled();
    fireEvent.submit(screen.getByRole('form',{name:'Budget line'}));
    expect(mutations).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Keep draft'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Activate Budget version'})).toHaveFocus());
    expect(version).toEqual(initial);expect(mutations).toHaveLength(0);
    expect(screen.getByLabelText('Annual amount (AUD)',{exact:false})).toHaveValue('888.00');
    fireEvent.click(screen.getByRole('button',{name:'Activate Budget version'}));
    const form=screen.getByRole('form',{name:'Activate Budget'});
    fireEvent.submit(form);fireEvent.submit(form);
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Budget version activated.'));
    expect(mutations).toEqual([{action:'activate'}]);expect(version.lines).toEqual(initial.lines);
    expect(screen.queryByRole('button',{name:'Confirm activation'})).not.toBeInTheDocument();
  });
  it('requires fresh confirmation after rejection and clears review on read-only reload',async()=>{
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Activate Budget version'}));
    failSave=true;fireEvent.click(screen.getByRole('button',{name:'Confirm activation'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save rejected.');
    expect(screen.queryByRole('button',{name:'Confirm activation'})).not.toBeInTheDocument();
    expect(version.status).toBe('DRAFT');
    fireEvent.click(screen.getByRole('button',{name:'Activate Budget version'}));
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved Budget reloaded.'));
    expect(screen.queryByRole('button',{name:'Confirm activation'})).not.toBeInTheDocument();
    expect(mutations).toHaveLength(1);
  });
  it('opens an empty calendar cell with fixed identities and cancels without mutation',async()=>{
    version.allocations=[];render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    fireEvent.click(screen.getByText('Amounts by line and period'));
    fireEvent.click(screen.getByRole('button',{name:'Add calendar allocation SOFTWARE / GENERAL / QTR 1'}));
    const form=within(screen.getByRole('form',{name:'Period allocation'}));
    expect(form.getByLabelText('Allocation line',{exact:false})).toHaveValue('SOFTWARE / GENERAL');
    expect(form.getByLabelText('Allocation period',{exact:false})).toHaveValue('QTR 1');
    expect(form.getByLabelText('Period amount (AUD)',{exact:false})).toHaveFocus();
    expect(form.getByLabelText('Period amount (AUD)',{exact:false})).toHaveValue('');
    fireEvent.click(form.getByRole('button',{name:'Cancel allocation editing'}));
    expect(mutations).toHaveLength(0);expect(version.allocations).toHaveLength(0);
    expect(screen.getByRole('region',{name:'Budget amount review'})).toHaveFocus();
  });
  it('saves a zero from the calendar, returns to review and reloads it as a saved allocation',async()=>{
    version.allocations=[];render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    fireEvent.click(screen.getByText('Amounts by line and period'));
    fireEvent.click(screen.getByRole('button',{name:'Add calendar allocation SOFTWARE / GENERAL / QTR 1'}));
    fireEvent.change(screen.getByLabelText('Period amount (AUD)',{exact:false}),{target:{value:'0.00'}});
    fireEvent.click(screen.getByRole('button',{name:'Save allocation'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Budget setup saved.'));
    expect(mutations).toEqual([{action:'allocation',budgetLineId:'line',financialPeriodId:'period',amountCents:'0'}]);
    expect(screen.getByRole('region',{name:'Budget amount review'})).toHaveFocus();
    expect(screen.getByRole('button',{name:'Edit calendar allocation SOFTWARE / GENERAL / QTR 1'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved Budget reloaded.'));
    expect(within(screen.getByRole('table',{name:'Totals by financial period'})).getByText('AUD 0.00')).toBeVisible();
    expect(mutations).toHaveLength(1);
  });
  it('restores the authoritative activated view after losing the activation response',async()=>{
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    loseResponse=true;fireEvent.click(screen.getByRole('button',{name:'Activate Budget version'}));
    fireEvent.click(screen.getByRole('button',{name:'Confirm activation'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('save outcome could not be confirmed');
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved Budget reloaded.'));
    expect(screen.queryByRole('button',{name:'Activate Budget version'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Remove draft line/})).not.toBeInTheDocument();
    expect(mutations).toHaveLength(1);
  });
  it('a dimension revision cannot unlock an uncertain save before explicit reload',async()=>{
    const view=render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    loseResponse=true;fireEvent.submit(screen.getByRole('form',{name:'Budget line'}));
    await screen.findByRole('alert');
    const reads=vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method!=='POST').length;
    view.rerender(<BudgetSetup revision={1}/>);
    expect(screen.getByRole('button',{name:'Update line'})).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method!=='POST')).toHaveLength(reads);
  });
  it('blocks two submissions in the same turn before state rerenders',async()=>{
    let release!:()=>void;postGate=new Promise<void>(resolve=>{release=resolve;});
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    const form=screen.getByRole('form',{name:'Budget line'});
    fireEvent.submit(form);fireEvent.submit(form);
    expect(mutations).toHaveLength(1);
    release();
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Budget setup saved.'));
  });
  it('manual reload discards unsaved editor values without saving',async()=>{
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    fireEvent.change(screen.getByLabelText('Annual amount (AUD)',{exact:false}),{target:{value:'888.00'}});
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Saved Budget reloaded.'));
    expect(version).toEqual(initial);expect(mutations).toHaveLength(0);
    expect(screen.getByRole('region',{name:'Budget amount review'})).toHaveTextContent('AUD 100.00');
    expect(screen.getByLabelText('Annual amount (AUD)',{exact:false})).toHaveValue('');
  });
  it('does not describe an unavailable initial setup as an empty Budget',async()=>{
    failRead=true;render(<BudgetSetup revision={0}/>);
    await screen.findByRole('alert');
    expect(screen.queryByText('No Budget versions yet. Create the first draft above.')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
    failRead=false;fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    expect(mutations).toHaveLength(0);
  });
  const removalCases=[
    {kind:'allocation',button:'Remove allocation SOFTWARE / GENERAL / QTR 1',form:'Remove draft period allocation',confirm:'Confirm remove allocation',keep:'Keep allocation',review:'Budget amount review',action:'remove-allocation',identity:{budgetLineId:'line',financialPeriodId:'period'},message:'Period allocation removed.'},
    {kind:'mapping',button:'Remove mapping GENERAL',form:'Remove draft commitment mapping',confirm:'Confirm remove mapping',keep:'Keep mapping',review:'Commitment mapping review',action:'remove-mapping',identity:{costCentreId:'centre'},message:'Commitment mapping removed.'},
  ] as const;
  it.each(removalCases)('$kind removal confirms, cancels without mutation, then refreshes only the selected entry',async item=>{
    render(<BudgetSetup revision={0}/>);
    const remove=await screen.findByRole('button',{name:item.button});
    fireEvent.click(remove);
    expect(mutations).toHaveLength(0);
    expect(screen.getByLabelText('Removal reason',{exact:false})).toHaveFocus();
    fireEvent.click(screen.getByRole('button',{name:item.keep}));
    expect(version).toEqual(initial);
    expect(mutations).toHaveLength(0);
    expect(screen.getByRole('region',{name:item.review})).toHaveFocus();
    fireEvent.click(remove);
    fireEvent.change(screen.getByLabelText('Removal reason',{exact:false}),{target:{value:'Accidental entry'}});
    fireEvent.click(screen.getByRole('button',{name:item.confirm}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent(item.message));
    expect(mutations).toEqual([{action:item.action,...item.identity,reason:'Accidental entry'}]);
    expect(version.lines).toEqual(initial.lines);
    expect(item.kind==='allocation'?version.mappings:version.allocations).toEqual(item.kind==='allocation'?initial.mappings:initial.allocations);
    expect(screen.getByRole('region',{name:item.review})).toHaveFocus();
    if(item.kind==='allocation') expect(screen.getByText('AUD 100.00 left to allocate')).toBeVisible();
    else expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeDisabled();
  });
  it.each(removalCases)('$kind failed removal retains the entered reason; switching to editing clears confirmation',async item=>{
    failSave=true;
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button',{name:item.button}));
    fireEvent.change(screen.getByLabelText('Removal reason',{exact:false}),{target:{value:'Accidental entry'}});
    fireEvent.click(screen.getByRole('button',{name:item.confirm}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save rejected.');
    expect(screen.getByLabelText('Removal reason',{exact:false})).toHaveValue('Accidental entry');
    expect(version).toEqual(initial);
    fireEvent.click(screen.getByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    expect(screen.queryByRole('form',{name:item.form})).not.toBeInTheDocument();
  });
  it('requires confirmation, supports cancellation, and returns to the saved review after removal', async () => {
    render(<BudgetSetup revision={0}/>);
    const remove = await screen.findByRole('button', { name: 'Remove draft line SOFTWARE / GENERAL' });
    fireEvent.click(remove);
    expect(mutations).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Draft line removal confirmation' })).toHaveTextContent('1 saved period allocation');
    expect(screen.getByLabelText('Removal reason', { exact: false })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft line' }));
    expect(version).toEqual(initial);
    expect(mutations).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Budget amount review' })).toHaveFocus();
    fireEvent.click(remove);
    fireEvent.change(screen.getByLabelText('Removal reason', { exact: false }), { target: { value: 'Accidental line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove draft line' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Draft line and its period allocations removed.'));
    expect(mutations).toEqual([{ action: 'remove-line', budgetLineId: 'line', reason: 'Accidental line' }]);
    expect(version.mappings).toEqual(initial.mappings);
    expect(screen.getByRole('region', { name: 'Budget amount review' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Activate Budget version' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Draft line removal confirmation' })).not.toBeInTheDocument();
  });
  it('retains a failed removal confirmation and reason for recovery', async () => {
    failSave = true;
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove draft line SOFTWARE / GENERAL' }));
    fireEvent.change(screen.getByLabelText('Removal reason', { exact: false }), { target: { value: 'Accidental line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove draft line' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save rejected.');
    expect(screen.getByLabelText('Removal reason', { exact: false })).toHaveValue('Accidental line');
    expect(version).toEqual(initial);
    expect(scroll).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE', 'SUPERSEDED'])('keeps %s versions free of removal controls', async status => {
    version.status = status;
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('table', { name: /Budget lines/ });
    expect(screen.queryByRole('button', { name: /Remove draft line/ })).not.toBeInTheDocument();
  });
  it('keeps mapping creation at the form instead of returning to review', async () => {
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('button', { name: 'Edit mapping GENERAL' });
    const form = within(screen.getByRole('form', { name: 'Commitment mapping' }));
    fireEvent.change(form.getByLabelText('Mapping cost centre', { exact: false }), { target: { value: 'centre' } });
    fireEvent.change(form.getByLabelText('Mapping account', { exact: false }), { target: { value: 'alternate' } });
    const save = form.getByRole('button', { name: 'Save commitment mapping' });
    save.focus(); fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Budget setup saved.'));
    expect(save).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
    expect(form.getByLabelText('Mapping account', { exact: false })).toHaveValue('');
  });
  it.each(cases)('$kind cancellation returns focus without saving', async item => {
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit }));
    const form = within(screen.getByRole('form', { name: item.form }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.cancel }));
    expect(screen.getByRole('region', { name: item.review })).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(mutations).toHaveLength(0);
    expect(version).toEqual(initial);
    expect(screen.getByRole('status')).toHaveTextContent('Saved Budget records are unchanged.');
  });
  it.each(cases)('$kind save returns focus to the refreshed review', async item => {
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit }));
    const form = within(screen.getByRole('form', { name: item.form }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.update }));
    await waitFor(() => expect(screen.getByRole('region', { name: item.review })).toHaveFocus());
    expect(mutations).toHaveLength(1);
    expect(mutations[0].action).toBe(item.kind);
    expect(screen.queryByRole('button', { name: item.cancel })).not.toBeInTheDocument();
    const review = screen.getByRole('region', { name: item.review });
    expect(review).toHaveTextContent(item.kind === 'line' ? 'AUD 120.00' : item.kind === 'allocation' ? 'AUD 90.00' : 'HOSTING');
  });
  it.each(cases)('$kind failed save retains the edit and does not return to review', async item => {
    failSave = true;
    render(<BudgetSetup revision={0}/>);
    fireEvent.click(await screen.findByRole('button', { name: item.edit }));
    const form = within(screen.getByRole('form', { name: item.form }));
    fireEvent.change(form.getByLabelText(item.field, { exact: false }), { target: { value: item.value } });
    fireEvent.click(form.getByRole('button', { name: item.update }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save rejected.');
    expect(form.getByLabelText(item.field, { exact: false })).toHaveValue(item.value);
    expect(scroll).not.toHaveBeenCalled();
    expect(version).toEqual(initial);
    fireEvent.click(form.getByRole('button', { name: item.cancel }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: item.review })).toHaveFocus();
  });
});
