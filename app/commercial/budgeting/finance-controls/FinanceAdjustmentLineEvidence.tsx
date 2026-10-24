'use client';
import { useState } from 'react';
import { buttonProps,tableStyles } from '@/components/ui/app';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { adjustmentClassificationCoverage,adjustmentSavedText } from '@/lib/commercial/financeAdjustmentDisplay';
import type { AdjustmentLine } from '@/lib/commercial/financeAdjustmentReviewModel';

export function FinanceAdjustmentLineEvidence({lines,currency}:{lines:AdjustmentLine[];currency:string}){
  const [view,setView]=useState<'cards'|'table'>('cards');
  const coverage=adjustmentClassificationCoverage(lines);
  const budget=(line:AdjustmentLine)=>line.budgetCents===null?'Unavailable · unresolved classification':formatMoneyCentsExact(line.budgetCents,currency);
  return <section aria-label="Saved adjustment lines" style={{minWidth:0}}>
    <h4>Saved lines and Budget classification</h4>
    <p style={{fontSize:12}}>{coverage.total} saved lines · {coverage.resolved} with saved Budget classification · {coverage.unresolved} unresolved. These counts describe this saved record; they do not assess current Budget readiness.</p>
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Unresolved Budget amounts are unavailable, not zero. Saved Budget/version/line identities describe the retained classification. Account and cost-centre labels describe the current read. Changing view does not reclassify a line.</p>
    <div role="group" aria-label="Adjustment line display" style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:12}}><button type="button" aria-pressed={view==='cards'} onClick={()=>setView('cards')} {...buttonProps('secondary','sm')}>Line cards</button><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')} {...buttonProps('secondary','sm')}>Detailed line table</button></div>
    {view==='cards'?<div>{lines.length?lines.map(line=><article key={line.id} aria-label={`Saved adjustment line ${line.position}`} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0}}>
      <h5 style={{fontSize:14,marginTop:0}}>Line {line.position} · {line.accountCode} · {line.centreCode}</h5><p style={{fontSize:12}}>{line.accountName} · {line.centreName}</p>
      <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>{[
        ['Exclusive',formatMoneyCentsExact(line.exclusiveCents,currency)],['Tax',formatMoneyCentsExact(line.taxCents,currency)],['Inclusive',formatMoneyCentsExact(line.inclusiveCents,currency)],['Saved Budget amount',budget(line)],
      ].map(([label,value])=><div key={label}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{label}</dt><dd style={{margin:0}}>{value}</dd></div>)}</dl>
      <p style={{fontSize:12}}>Saved Budget basis: {line.resolvedBasis??'Unresolved'}.</p><p style={{fontSize:12,whiteSpace:'pre-wrap'}}>Narrative: {adjustmentSavedText(line.narrative)}</p>
      <details><summary>Saved line and classification identities</summary><dl>{[
        ['Line ID',line.id],['Account ID',line.accountId],['Cost centre ID',line.centreId],['Budget ID',line.resolvedBudgetId],['Budget version ID',line.resolvedVersionId],['Budget line ID',line.resolvedLineId],['Source bill line ID',line.sourceBillLineId],
      ].map(([label,value])=><div key={label}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{label}</dt><dd style={{margin:'0 0 8px',whiteSpace:'pre-wrap'}}>{adjustmentSavedText(value)}</dd></div>)}</dl></details>
    </article>):<p>No saved adjustment lines. This does not establish a completed classification.</p>}</div>:<div role="region" aria-label="Adjustment line evidence" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:1100}}><thead><tr>{['Position','Account','Cost centre','Exclusive','Tax','Inclusive','Saved Budget basis','Saved Budget amount','Saved identities','Narrative'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{lines.length?lines.map(line=><tr key={line.id}>
      <td>{line.position}</td><td>{line.accountCode} · {line.accountName}</td><td>{line.centreCode} · {line.centreName}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.exclusiveCents,currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.taxCents,currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(line.inclusiveCents,currency)}</td><td>{line.resolvedBasis??'Unresolved'}</td><td className={tableStyles.num}>{budget(line)}</td>
      <td><details><summary>Line and classification IDs</summary><p>Line: {line.id}</p><p>Account: {line.accountId}</p><p>Cost centre: {line.centreId}</p><p>Budget: {adjustmentSavedText(line.resolvedBudgetId)}</p><p>Version: {adjustmentSavedText(line.resolvedVersionId)}</p><p>Budget line: {adjustmentSavedText(line.resolvedLineId)}</p><p>Source bill line: {adjustmentSavedText(line.sourceBillLineId)}</p></details></td><td style={{whiteSpace:'pre-wrap'}}>{adjustmentSavedText(line.narrative)}</td>
    </tr>):<tr><td colSpan={10}>No saved adjustment lines. Classification completion is not established.</td></tr>}</tbody></table></div>}
  </section>;
}
