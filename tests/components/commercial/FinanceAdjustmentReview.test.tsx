import { act,cleanup,fireEvent,render,screen,within,waitFor } from '@testing-library/react';
import { beforeAll,afterAll,afterEach,describe,expect,it,vi } from 'vitest';
import { FinanceAdjustmentReview } from '@/app/commercial/budgeting/finance-controls/FinanceAdjustmentReview';
import { adjustmentScope,adjustmentHeader,adjustmentLine,adjustmentEvents,adjustmentReport,adjustmentEvidence } from '../../fixtures/commercialAdjustmentReview';
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const props={periodId:adjustmentScope.periodId,currency:'AUD',enabled:true,revision:0};
const setup=(fetcher:ReturnType<typeof vi.fn>)=>{vi.stubGlobal('fetch',fetcher);return render(<FinanceAdjustmentReview {...props}/>);};
const standard=()=>vi.fn(async(url:string)=>Response.json(url.includes('id=')?{evidence:adjustmentEvidence}:{report:adjustmentReport}));
describe('Read-only finance adjustment register and lifecycle evidence',()=>{
  it('shows exact numbers, saved line totals and full lifecycle evidence; closing restores focus',async()=>{
    const fetcher=standard();setup(fetcher);const button=await screen.findByRole('button',{name:'Review adjustment 9007199254740993'});fireEvent.click(button);
    const detail=within(await screen.findByRole('region',{name:'Saved adjustment evidence'}));expect(detail.getByText(/exclusive \$90,071,992,547,409\.93/)).toBeVisible();expect(detail.getByRole('region',{name:'Saved adjustment lines'})).toHaveTextContent('$90,071,992,547,409.93');
    const history=within(detail.getByRole('region',{name:'Adjustment lifecycle history'}));expect(history.getByText('Adjustment created')).toBeVisible();expect(history.getByText('Posting recorded')).toBeVisible();
    fireEvent.click(detail.getByRole('button',{name:'Close adjustment evidence'}));await waitFor(()=>expect(button).toHaveFocus());expect(fetcher.mock.calls.every(call=>call[0].includes('/review?'))).toBe(true);
  });
  it('shows unresolved draft amounts as unavailable instead of classified zero',async()=>{
    const header={...adjustmentHeader,status:'DRAFT' as const,postedAt:null,postedBy:null};const line={...adjustmentLine,resolvedBudgetId:null,resolvedVersionId:null,resolvedLineId:null,resolvedBasis:null,budgetCents:null};
    setup(vi.fn(async(url:string)=>Response.json(url.includes('id=')?{evidence:{adjustment:header,lines:[line],events:[adjustmentEvents[0]]}}:{report:{...adjustmentReport,adjustments:[header]}})));
    fireEvent.click(await screen.findByRole('button',{name:'Review adjustment 9007199254740993'}));await screen.findByRole('region',{name:'Saved adjustment evidence'});expect(screen.getByRole('region',{name:'Saved adjustment lines'})).toHaveTextContent('Unresolved');expect(screen.getByRole('region',{name:'Saved adjustment lines'})).toHaveTextContent('Unavailable');
  });
  it('does not fetch without confirmed controls or a valid currency',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<FinanceAdjustmentReview {...props} currency="" enabled={false}/>);expect(fetcher).not.toHaveBeenCalled();expect(screen.getByText(/Choose a financial period/)).toBeVisible();
  });
  it.each(['missing','wrong-scope','incomplete'])('withholds invalid %s evidence and recovers through fresh register reads',async failure=>{
    let broken=true;const fetcher=vi.fn(async(url:string)=>Response.json(url.includes('id=')?{evidence:broken?failure==='missing'?null:failure==='wrong-scope'?{...adjustmentEvidence,adjustment:{...adjustmentHeader,currency:'USD'}}:{...adjustmentEvidence,events:[]}:adjustmentEvidence}:{report:adjustmentReport}));setup(fetcher);
    fireEvent.click(await screen.findByRole('button',{name:'Review adjustment 9007199254740993'}));await screen.findByRole('alert');expect(screen.queryByRole('region',{name:'Saved adjustment evidence'})).not.toBeInTheDocument();
    broken=false;fireEvent.click(screen.getByRole('button',{name:'Reload adjustment register'}));fireEvent.click(await screen.findByRole('button',{name:'Review adjustment 9007199254740993'}));await screen.findByRole('region',{name:'Saved adjustment evidence'});expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('status changes reset pagination and ignore evidence from a previous scope',async()=>{
    let resolve!:(value:Response)=>void;
    const fetcher=vi.fn((url:string)=>{const query=new URL(url,'http://localhost').searchParams;if(query.has('id'))return new Promise<Response>(done=>{resolve=done;});const status=query.get('status')??'';return Promise.resolve(Response.json({report:{...adjustmentReport,scope:{...adjustmentScope,status},totalCount:status==='DRAFT'?0:1,adjustments:status==='DRAFT'?[]:[adjustmentHeader]}}));});setup(fetcher);
    fireEvent.click(await screen.findByRole('button',{name:'Review adjustment 9007199254740993'}));await screen.findByText('Loading saved adjustment evidence…');fireEvent.change(screen.getByLabelText('Adjustment status'),{target:{value:'DRAFT'}});await screen.findByText('No finance adjustments match this scope.');
    await act(async()=>resolve(Response.json({evidence:adjustmentEvidence})));expect(screen.queryByRole('region',{name:'Saved adjustment evidence'})).not.toBeInTheDocument();const lastQuery=new URL(fetcher.mock.calls.at(-1)![0],'http://localhost').searchParams;expect(lastQuery.get('status')).toBe('DRAFT');expect(lastQuery.get('page')).toBe('1');
  });
  it('does not preserve authoritative evidence through a control lock or revision change',async()=>{
    const fetcher=standard();const view=setup(fetcher);fireEvent.click(await screen.findByRole('button',{name:'Review adjustment 9007199254740993'}));await screen.findByRole('region',{name:'Saved adjustment evidence'});
    view.rerender(<FinanceAdjustmentReview {...props} enabled={false}/>);expect(screen.queryByRole('region',{name:'Saved adjustment evidence'})).not.toBeInTheDocument();view.rerender(<FinanceAdjustmentReview {...props} revision={1}/>);await screen.findByRole('button',{name:'Review adjustment 9007199254740993'});expect(screen.queryByRole('region',{name:'Saved adjustment evidence'})).not.toBeInTheDocument();
  });
  it('distinguishes a failed register from a confirmed empty result',async()=>{
    let broken=true;setup(vi.fn(async()=>broken?Response.json({}, {status:503}):Response.json({report:{...adjustmentReport,totalCount:0,adjustments:[]}})));await screen.findByRole('alert');expect(screen.queryByText('No finance adjustments match this scope.')).not.toBeInTheDocument();broken=false;fireEvent.click(screen.getByRole('button',{name:'Reload adjustment register'}));await screen.findByText('No finance adjustments match this scope.');
  });
});
