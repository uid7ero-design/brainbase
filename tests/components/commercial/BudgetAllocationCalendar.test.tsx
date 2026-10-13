import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import BudgetAllocationCalendar from '@/app/commercial/budgeting/setup/BudgetAllocationCalendar';
afterEach(cleanup);
const base={currency:'AUD',draft:true,busy:false,lines:[{id:'a',budget_account_id:'SOFTWARE',cost_centre_id:'GENERAL'},{id:'b',budget_account_id:'HOSTING',cost_centre_id:'GENERAL'}],periods:[{id:'q1',name:'QTR 1'},{id:'q2',name:'QTR 2'}],accountCode:(id:string)=>id,centreCode:(id:string)=>id,onSelect:vi.fn()};
describe('Saved allocation calendar',()=>{
  it('keeps totals exact above the safe integer limit and separates saved zero from an empty period',()=>{
    render(<BudgetAllocationCalendar {...base} allocations={[{budget_line_id:'a',financial_period_id:'q1',amount_cents:'9007199254740993'},{budget_line_id:'b',financial_period_id:'q1',amount_cents:'2'}]}/>);
    const rows=within(screen.getByRole('table',{name:'Totals by financial period'})).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('AUD 90,071,992,547,409.95');expect(rows[2]).toHaveTextContent('Not entered');
  });
  it('distinguishes saved zero and new entry actions without requiring every period',()=>{
    render(<BudgetAllocationCalendar {...base} allocations={[{budget_line_id:'a',financial_period_id:'q1',amount_cents:'0'}]}/>);
    fireEvent.click(screen.getByText('Amounts by line and period'));
    const table=screen.getByRole('table',{name:'Allocation amounts by line and period'});
    expect(within(table).getByText('AUD 0.00')).toBeVisible();
    expect(screen.getByText(/every period does not need an entry/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Add calendar allocation SOFTWARE / GENERAL / QTR 2'}));
    expect(base.onSelect).toHaveBeenLastCalledWith('a','q2');
    fireEvent.click(screen.getByRole('button',{name:'Edit calendar allocation SOFTWARE / GENERAL / QTR 1'}));
    expect(base.onSelect).toHaveBeenLastCalledWith('a','q1');
  });
  it('flags unavailable references and excludes them from period totals',()=>{
    render(<BudgetAllocationCalendar {...base} allocations={[{budget_line_id:'missing',financial_period_id:'q1',amount_cents:'999'},{budget_line_id:'a',financial_period_id:'missing',amount_cents:'999'}]}/>);
    expect(screen.getByText(/2 saved allocations use an unavailable/)).toBeVisible();
    expect(within(screen.getByRole('table',{name:'Totals by financial period'})).getAllByText('Not entered')).toHaveLength(2);
  });
  it('locks draft actions while busy and leaves published versions read-only',()=>{
    const view=render(<BudgetAllocationCalendar {...base} busy allocations={[]}/>);
    fireEvent.click(screen.getByText('Amounts by line and period'));
    for(const button of screen.getAllByRole('button'))expect(button).toBeDisabled();
    view.rerender(<BudgetAllocationCalendar {...base} draft={false} allocations={[]}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('explains an unavailable calendar without inventing amounts or entry actions',()=>{
    render(<BudgetAllocationCalendar {...base} periods={[]} allocations={[]}/>);
    expect(screen.getByText('No financial periods available.')).toBeVisible();
    expect(screen.queryByText('Amounts by line and period')).not.toBeInTheDocument();
  });
});
