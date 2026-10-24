import { act,cleanup,render,screen,waitFor } from '@testing-library/react';
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
import { FinanceReconciliationEvidence } from '@/app/commercial/budgeting/finance-controls/FinanceReconciliationEvidence';
import { FinanceSnapshotComparison } from '@/app/commercial/budgeting/finance-controls/FinanceSnapshotComparison';
import { FinanceReconciliationControls } from '@/app/commercial/budgeting/finance-controls/FinanceReconciliationControls';
import { FinanceCloseHistory } from '@/app/commercial/budgeting/finance-controls/FinanceCloseHistory';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { financeId,reconciliationFixture,financeReadAt } from '../../fixtures/commercialFinanceEvidence';
import { fireEvent } from '@testing-library/react';
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()}));
afterAll(()=>{if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});

describe('Finance evidence read ownership and browser download lifecycle',()=>{
  it('preserves Review/Sign-off gates across cards, table and working locks',()=>{
    const saved=reconciliationFixture();const row={...saved.header,financialYearName:'Year',financialPeriodName:'October',sourceSystemId:'ledger',brainbaseEffectiveActualCents:saved.header.effectiveActualCents,externalGlTotalCents:saved.header.externalGlCents,unresolvedItemCount:0,status:'REVIEWED' as const};
    const onReview=vi.fn(),onSignOff=vi.fn(),onInspect=vi.fn();const view=render(<FinanceReconciliationControls records={[row]} activeCloseId={null} working={false} onReview={onReview} onSignOff={onSignOff} onInspect={onInspect}/>);
    expect(screen.getByRole('button',{name:'Sign off'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Detailed controls table'}));expect(screen.getByRole('table')).toHaveTextContent('REVIEWED');expect(screen.getByRole('button',{name:'Sign off'})).toBeDisabled();
    view.rerender(<FinanceReconciliationControls records={[row]} activeCloseId={financeId(8)} working={false} onReview={onReview} onSignOff={onSignOff} onInspect={onInspect}/>);fireEvent.click(screen.getByRole('button',{name:'Sign off'}));expect(onSignOff).toHaveBeenCalledExactlyOnceWith(row.id);expect(onReview).not.toHaveBeenCalled();
    view.rerender(<FinanceReconciliationControls records={[row]} activeCloseId={financeId(8)} working={true} onReview={onReview} onSignOff={onSignOff} onInspect={onInspect}/>);expect(screen.getByRole('button',{name:'Inspect evidence'})).toBeDisabled();expect(screen.getByRole('button',{name:'Sign off'})).toBeDisabled();
  });
  it('retains valid zero captured counts and distinguishes unknown history totals',()=>{
    const records=[{id:financeId(8),close_sequence:1,status:'CLOSED' as const,closed_at:financeReadAt,close_reason:null,invalidated_at:null,invalidation_reason:null,control_totals:{basis:'C7_9_YEAR_CLOSE',financialPeriodCount:0,currentPeriodCloseCount:0}},{id:financeId(9),close_sequence:2,status:'CLOSED' as const,closed_at:financeReadAt,close_reason:null,invalidated_at:null,invalidation_reason:null,control_totals:{basis:'future'}}];
    render(<FinanceCloseHistory kind="year" records={records} working={false} onInspect={vi.fn()}/>);expect(screen.getByText(/At close: 0 financial periods/)).toBeVisible();expect(screen.getByText(/No recognised year-count summary/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Year close history status'),{target:{value:'INVALIDATED'}});expect(screen.getByText('No loaded close records match this status filter.')).toBeVisible();expect(screen.queryByRole('button',{name:'Inspect year close 1'})).not.toBeInTheDocument();
  });
  it('aborts the old record and ignores a late response after navigation',async()=>{
    const first=reconciliationFixture(),second={...reconciliationFixture(),header:{...first.header,id:financeId(99),periodName:'Second saved record'}};
    const pending:Array<{resolve:(value:Response)=>void;signal:AbortSignal}>=[];
    vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise<Response>(resolve=>pending.push({resolve,signal:options.signal as AbortSignal}))));
    const view=render(<FinanceReconciliationEvidence id={first.header.id} scope={first.scope} onClose={vi.fn()}/>);
    view.rerender(<FinanceReconciliationEvidence id={second.header.id} scope={second.scope} onClose={vi.fn()}/>);
    expect(pending[0].signal.aborted).toBe(true);
    await act(async()=>pending[0].resolve(Response.json({evidence:first})));expect(screen.queryByText(/2026–2027 · October · PREPARED/)).not.toBeInTheDocument();
    await act(async()=>pending[1].resolve(Response.json({evidence:second})));await screen.findByText(/Second saved record · PREPARED/);
    expect(screen.getByRole('button',{name:'Item cards'})).toHaveAttribute('aria-pressed','true');
    view.unmount();expect(pending[1].signal.aborted).toBe(true);
  });
  it('withholds comparison/downloads and aborts the sibling when one read fails',async()=>{
    const saved=reconciliationFixture();let siblingSignal:AbortSignal|undefined;
    vi.stubGlobal('fetch',vi.fn((url:string,options:RequestInit)=>{
      if(new URL(url,'http://localhost').searchParams.get('id')===saved.header.id)return Promise.resolve(new Response(null,{status:503}));
      siblingSignal=options.signal as AbortSignal;return new Promise<Response>(()=>{});
    }));
    render(<FinanceSnapshotComparison scope={saved.scope} baselineId={saved.header.id} comparisonId={financeId(99)} onClose={vi.fn()} onInspect={vi.fn()} onSwap={vi.fn()}/>);
    await screen.findByRole('alert');await waitFor(()=>expect(siblingSignal?.aborted).toBe(true));expect(screen.queryByRole('button',{name:'Download comparison JSON'})).not.toBeInTheDocument();expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('retains successful download URLs for browser consumption and removes the temporary anchor',()=>{
    vi.useFakeTimers();const revoke=vi.fn();vi.stubGlobal('URL',{createObjectURL:vi.fn(()=>'blob:finance-test'),revokeObjectURL:revoke});const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    expect(requestFinanceEvidenceDownload({filename:'evidence.json',type:'application/json',content:'{}'})).toContain('Download requested');expect(click).toHaveBeenCalledOnce();expect(document.querySelector('a[download]')).toBeNull();expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);expect(revoke).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:finance-test');
  });
  it('cleans up immediately and reports failure when the browser click throws',()=>{
    vi.useFakeTimers();const revoke=vi.fn();vi.stubGlobal('URL',{createObjectURL:vi.fn(()=>'blob:finance-test'),revokeObjectURL:revoke});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{throw new Error('Browser failure');});
    expect(()=>requestFinanceEvidenceDownload({filename:'evidence.csv',type:'text/csv',content:'test'})).toThrow('Unable to request');expect(revoke).toHaveBeenCalledOnce();expect(document.querySelector('a[download]')).toBeNull();expect(vi.getTimerCount()).toBe(0);
  });
});
