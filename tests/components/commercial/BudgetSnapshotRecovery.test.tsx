import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import BudgetSetup from '@/app/commercial/budgeting/setup/BudgetSetup';
const initial={budget_id:'budget',version_id:'version',name:'Draft',financial_year_id:'year',currency:'AUD',tax_basis:'EXCLUSIVE',periodisation_mode:'PERIODISED',version_number:1,status:'DRAFT',can_edit_settings:true,
  lines:[{id:'line',budget_account_id:'account',cost_centre_id:'centre',annual_budget_cents:'10000'}],
  allocations:[{budget_line_id:'line',financial_period_id:'period',amount_cents:'10000'}],mappings:[{cost_centre_id:'centre',budget_account_id:'account'}]};
let version:typeof initial,broken:string|null,afterSaveBroken:boolean,posts:number;
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});
beforeEach(()=>{
  version=structuredClone(initial);broken=null;afterSaveBroken=false;posts=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.method==='POST'){posts++;version.lines[0].annual_budget_cents=JSON.parse(String(options.body)).annualBudgetCents;if(afterSaveBroken)broken='budgets';return Response.json({});}
    if(broken&&url.endsWith('/'+broken))return Response.json({});
    if(url.endsWith('/budgets'))return Response.json({versions:[version]});
    if(url.endsWith('/financial-periods'))return Response.json({years:[{id:'year',name:'FY',status:'OPEN',periods:[{id:'period',name:'QTR 1'}]}]});
    return Response.json({records:[url.endsWith('/accounts')?{id:'account',code:'SOFTWARE',active:true}:{id:'centre',code:'GENERAL',active:true}]});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('Complete saved Budget snapshots',()=>{
  it.each(['budgets','financial-periods','accounts','cost-centres'])('keeps mutations paused when %s is incomplete',async endpoint=>{
    broken=endpoint;render(<BudgetSetup revision={0}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('saved Budget view is incomplete');
    expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
    expect(screen.queryByText('No Budget versions yet. Create the first draft above.')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form',{name:'Create Budget'}));expect(posts).toBe(0);
    broken=null;fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeEnabled();expect(posts).toBe(0);
  });
  it.each(['lines','allocations','mappings'] as const)('retains the last saved view while a malformed %s reload is rejected',async field=>{
    render(<BudgetSetup revision={0}/>);await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'});
    const good=version[field];(version as unknown as Record<string,unknown>)[field]=null;
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await screen.findByRole('alert');
    expect(screen.getByRole('button',{name:'Edit SOFTWARE / GENERAL'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Activate Budget version'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Export Budget lines CSV'})).toBeDisabled();
    expect(screen.getByRole('table',{name:'Budget lines and allocation checks'})).toHaveTextContent('AUD 100.00');
    (version as unknown as Record<string,unknown>)[field]=good;
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Edit SOFTWARE / GENERAL'})).toBeEnabled());expect(posts).toBe(0);
  });
  it.each([123, '12.34', '-1', 'not-an-amount'])('rejects malformed cents %s instead of converting them to zero',async value=>{
    (version.lines[0] as unknown as Record<string,unknown>).annual_budget_cents=value;
    render(<BudgetSetup revision={0}/>);
    await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Create draft Budget'})).toBeDisabled();
    expect(screen.queryByRole('table',{name:'Budget lines and allocation checks'})).not.toBeInTheDocument();
  });
  it('recovers a committed edit whose readback is incomplete without repeating the save',async()=>{
    render(<BudgetSetup revision={0}/>);fireEvent.click(await screen.findByRole('button',{name:'Edit SOFTWARE / GENERAL'}));
    const form=within(screen.getByRole('form',{name:'Budget line'}));
    fireEvent.change(form.getByLabelText('Annual amount (AUD)',{exact:false}),{target:{value:'123.45'}});afterSaveBroken=true;
    fireEvent.click(form.getByRole('button',{name:'Update line'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your change was saved');
    expect(version.lines[0].annual_budget_cents).toBe('12345');
    fireEvent.submit(screen.getByRole('form',{name:'Budget line'}));expect(posts).toBe(1);
    fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));await screen.findByText(/saved Budget view is incomplete/);
    broken=null;fireEvent.click(screen.getByRole('button',{name:'Reload saved Budget'}));
    await waitFor(()=>expect(screen.getByRole('table',{name:'Budget lines and allocation checks'})).toHaveTextContent('AUD 123.45'));
    expect(posts).toBe(1);
  });
  it('preserves exact large amounts and missing references for review',async()=>{
    version.lines[0].annual_budget_cents='9223372036854775807';version.lines[0].budget_account_id='missing-account';
    render(<BudgetSetup revision={0}/>);
    const table=await screen.findByRole('table',{name:'Budget lines and allocation checks'});
    expect(table).toHaveTextContent('AUD 92,233,720,368,547,758.07');expect(table).toHaveTextContent('missing-account');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
