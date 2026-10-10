import { TableContainer,tableStyles,buttonProps } from '@/components/ui/app';
import { formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Props={
  currency:string;draft:boolean;busy:boolean;
  lines:{id:string;budget_account_id:string;cost_centre_id:string}[];
  allocations:{budget_line_id:string;financial_period_id:string;amount_cents:string}[];
  periods:{id:string;name:string}[];
  accountCode:(id:string)=>string;centreCode:(id:string)=>string;
  onSelect:(lineId:string,periodId:string)=>void;
};
export default function BudgetAllocationCalendar({currency,draft,busy,lines,allocations,periods,accountCode,centreCode,onSelect}:Props){
  const lineIds=new Set(lines.map(line=>line.id)),periodIds=new Set(periods.map(period=>period.id));
  const amounts=new Map<string,Map<string,string>>(),totals=new Map<string,bigint>(),counts=new Map<string,number>();
  let unavailable=0;
  for(const allocation of allocations){
    if(!lineIds.has(allocation.budget_line_id)||!periodIds.has(allocation.financial_period_id)){unavailable++;continue;}
    const row=amounts.get(allocation.budget_line_id)??new Map<string,string>();
    row.set(allocation.financial_period_id,allocation.amount_cents);amounts.set(allocation.budget_line_id,row);
    totals.set(allocation.financial_period_id,(totals.get(allocation.financial_period_id)??BigInt(0))+BigInt(allocation.amount_cents));
    counts.set(allocation.financial_period_id,(counts.get(allocation.financial_period_id)??0)+1);
  }
  const money=(amount:string)=>formatBudgetAmount(amount,currency);
  return <section aria-label="Budget allocation calendar" className={`${styles.budgetReview} ${styles.allocationCalendar}`}>
    <h3>Allocation calendar</h3>
    <p>Review saved amounts across the financial calendar. Not entered means no saved allocation; it is different from a saved zero. Each line’s total must match its annual amount, but every period does not need an entry.</p>
    {unavailable>0&&<p className={styles.reviewWarning}>{unavailable} saved allocations use an unavailable line or period and are excluded here. Review the saved period allocation list.</p>}
    <TableContainer label="Allocation totals by period" minWidth={500}>
      <table className={tableStyles.table}>
        <caption className={styles.reviewCaption}>Totals by financial period</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Saved allocations</th><th scope="col">Amount ({currency})</th></tr></thead>
        <tbody>{periods.length?periods.map(period=><tr key={period.id}><th scope="row">{period.name}</th><td>{counts.get(period.id)??0}</td><td>{totals.has(period.id)?money(totals.get(period.id)!.toString()):'Not entered'}</td></tr>):<tr><td colSpan={3}>No financial periods available.</td></tr>}</tbody>
      </table>
    </TableContainer>
    {lines.length>0&&periods.length>0&&<details className={styles.settingsDisclosure}>
      <summary>Amounts by line and period</summary>
      <TableContainer label="Allocation amounts by line and period" minWidth={Math.max(600,240+periods.length*180)}>
        <table className={tableStyles.table}>
          <caption className={styles.reviewCaption}>Allocation amounts by line and period</caption>
          <thead><tr><th scope="col">Account / Cost centre</th>{periods.map(period=><th key={period.id} scope="col">{period.name}</th>)}</tr></thead>
          <tbody>{lines.map(line=>{const label=accountCode(line.budget_account_id)+' / '+centreCode(line.cost_centre_id);return <tr key={line.id}>
            <th scope="row">{label}</th>{periods.map(period=>{const amount=amounts.get(line.id)?.get(period.id);return <td key={period.id}>
              <span>{amount===undefined?'Not entered':money(amount)}</span>
              {draft&&<div className={styles.reviewActions}><button {...buttonProps('secondary')} type="button" disabled={busy} aria-label={`${amount===undefined?'Add':'Edit'} calendar allocation ${label} / ${period.name}`} onClick={()=>onSelect(line.id,period.id)}>{amount===undefined?'Add amount':'Edit amount'}</button></div>}
            </td>;})}
          </tr>;})}</tbody>
        </table>
      </TableContainer>
    </details>}
  </section>;
}
