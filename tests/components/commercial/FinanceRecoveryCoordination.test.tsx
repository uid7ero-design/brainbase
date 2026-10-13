import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import FinanceSetup from '@/app/commercial/budgeting/setup/FinanceSetup';
import BudgetSetup from '@/app/commercial/budgeting/setup/BudgetSetup';
const baseline={budget_id:'budget',version_id:'version',name:'Draft',financial_year_id:'year',currency:'AUD',tax_basis:'EXCLUSIVE',periodisation_mode:'PERIODISED',version_number:1,status:'DRAFT',can_edit_settings:true,
 lines:[{id:'line',budget_account_id:'account',cost_centre_id:'centre',annual_budget_cents:'10000'}],allocations:[{budget_line_id:'line',financial_period_id:'period',amount_cents:'10000'}],mappings:[{cost_centre_id:'centre',budget_account_id:'account'}]};
let version:typeof baseline,accounts:{id:string;code:string;name:string;description:null;active:boolean}[],centres:typeof accounts;
let periods:{id:string;name:string;starts_on:string;ends_on:string;status:string}[];
let failRead:string|null,reject:boolean,budgetGate:Promise<void>|undefined,postGate:Promise<void>|undefined;
let budgetPosts:number,budgetReads:number;
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});
beforeEach(()=>{
 version=structuredClone(baseline);accounts=[{id:'account',code:'SOFTWARE',name:'Software',description:null,active:true}];centres=[{id:'centre',code:'GENERAL',name:'General',description:null,active:true}];
 periods=[{id:'period',name:'July',starts_on:'2027-07-01',ends_on:'2027-07-31',status:'OPEN'}];
 failRead=null;reject=false;budgetGate=undefined;postGate=undefined;budgetPosts=0;budgetReads=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(options?.method==='POST'){
   if(url.includes('/budgets')){budgetPosts++;if(postGate)await postGate;version.lines[0].annual_budget_cents=JSON.parse(String(options.body)).annualBudgetCents;return Response.json({});}
   if(reject)return Response.json({error:'Active Budget uses this record.'},{status:409});
   if(url.includes('/accounts/'))accounts[0].active=false;
   else if(url.includes('/cost-centres/'))centres[0].active=false;
   else periods.push({id:'august',name:'August',starts_on:'2027-08-01',ends_on:'2027-08-31',status:'OPEN'});
   throw new Error('Response lost');
  }
  if(failRead&&url.endsWith('/'+failRead))throw new Error('Read unavailable');
  if(url.endsWith('/budgets')){budgetReads++;if(budgetGate)await budgetGate;return Response.json({versions:[version]});}
  if(url.endsWith('/financial-periods'))return Response.json({years:[{id:'year',name:'FY',starts_on:'2027-07-01',ends_on:'2028-06-30',status:'OPEN',periods}]});
  return Response.json({records:url.endsWith('/accounts')?accounts:centres});
 }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function ready(){await waitFor(()=>expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeEnabled());}
describe('Finance setup recovery coordination',()=>{
 it.each([['Budget accounts','SOFTWARE','accounts'],['Cost centres','GENERAL','cost-centres']] as const)('pauses Budget for lost %s changes until source recovery and a fresh read',async(title,code,kind)=>{
  render(<FinanceSetup/>);await ready();const section=within(screen.getByRole('region',{name:title}));
  fireEvent.click(section.getByRole('button',{name:'Deactivate '+code}));
  const recovery=await screen.findByRole('region',{name:'Finance setup recovery'});
  expect(within(recovery).getByRole('link',{name:title})).toHaveAttribute('href','#dimension-'+kind);
  expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Export Budget lines CSV'})).toBeDisabled();
  fireEvent.submit(screen.getByRole('form',{name:'Create Budget'}));expect(budgetPosts).toBe(0);
  failRead=kind;fireEvent.click(section.getByRole('button',{name:'Reload '+title.toLowerCase()}));await section.findByText('Read unavailable');
  expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
  failRead=null;let release!:()=>void;budgetGate=new Promise<void>(resolve=>{release=resolve;});
  fireEvent.click(section.getByRole('button',{name:'Reload '+title.toLowerCase()}));
  await section.findByText(/reloaded. Review/);expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
  release();await waitFor(()=>expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeEnabled());
  expect(screen.queryByRole('region',{name:'Finance setup recovery'})).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'Draft activation checks'})).toHaveTextContent('inactive');expect(budgetPosts).toBe(0);
 });
 it('keeps other unresolved sections paused when only one is recovered',async()=>{
  render(<FinanceSetup/>);await ready();
  fireEvent.click(screen.getByRole('button',{name:'Deactivate SOFTWARE'}));await screen.findByRole('region',{name:'Finance setup recovery'});
  fireEvent.click(screen.getByRole('button',{name:'Deactivate GENERAL'}));
  await waitFor(()=>expect(within(screen.getByRole('region',{name:'Finance setup recovery'})).getAllByRole('link')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'Reload budget accounts'}));
  await waitFor(()=>expect(within(screen.getByRole('region',{name:'Finance setup recovery'})).getAllByRole('link')).toHaveLength(1));
  expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Reload cost centres'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeEnabled());
 });
 it('coordinates uncertain calendar changes and renders recovered periods',async()=>{
  render(<FinanceSetup/>);await ready();const form=within(screen.getByRole('form',{name:'Create financial period'}));
  fireEvent.change(form.getByLabelText('Period name',{exact:false}),{target:{value:'August'}});
  fireEvent.change(form.getByLabelText('Period start date',{exact:false}),{target:{value:'01/08/2027'}});
  fireEvent.change(form.getByLabelText('Period end date',{exact:false}),{target:{value:'31/08/2027'}});
  fireEvent.submit(screen.getByRole('form',{name:'Create financial period'}));
  const notice=await screen.findByRole('region',{name:'Finance setup recovery'});expect(within(notice).getByRole('link',{name:'Financial calendar'})).toHaveAttribute('href','#configure-periods');
  expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Reload financial calendar'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeEnabled());
  expect(within(screen.getByRole('form',{name:'Period allocation'})).getByRole('option',{name:'August'})).toBeInTheDocument();expect(budgetPosts).toBe(0);
 });
 it('does not pause Budget after an authoritative rejection',async()=>{
  render(<FinanceSetup/>);await ready();reject=true;fireEvent.click(screen.getByRole('button',{name:'Deactivate SOFTWARE'}));
  await screen.findByText('Active Budget uses this record.');expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeEnabled();
  expect(screen.queryByRole('region',{name:'Finance setup recovery'})).not.toBeInTheDocument();
 });
 it('blocks submission when synchronous setup state changes before new props arrive',async()=>{
  let current=true;render(<BudgetSetup revision={0} isSetupCurrent={()=>current}/>);await ready();
  current=false;fireEvent.submit(screen.getByRole('form',{name:'Create Budget'}));expect(budgetPosts).toBe(0);
 });
 it('refreshes a revision received while a Budget save is in progress',async()=>{
  const view=render(<BudgetSetup revision={0}/>);await ready();fireEvent.click(screen.getByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
  const form=within(screen.getByRole('form',{name:'Budget line'}));fireEvent.change(form.getByLabelText('Annual amount (AUD)',{exact:false}),{target:{value:'100.00'}});
  let release!:()=>void;postGate=new Promise<void>(resolve=>{release=resolve;});fireEvent.click(form.getByRole('button',{name:'Update line'}));
  view.rerender(<BudgetSetup revision={1}/>);release();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeEnabled());
  expect(budgetReads).toBeGreaterThanOrEqual(3);expect(budgetPosts).toBe(1);
 });
});
