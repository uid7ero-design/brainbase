import { buttonProps } from '@/components/ui/app';
import { reviewFinanceControls, type FinanceControlReviewInput,type FinanceReviewSnapshot } from '@/lib/commercial/financeControlReview';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';

export function FinanceControlReview(props: FinanceControlReviewInput&{onInspectSnapshot?:(snapshot:FinanceReviewSnapshot,trigger:HTMLButtonElement)=>void}) {
  const review = reviewFinanceControls(props);
  return <section aria-label="Finance control review checklist" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 18 }}>
    <h2 style={{ fontSize: 16, marginTop: 0 }}>Review your next finance step</h2>
    <p><strong>{review.summary}</strong></p>
    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>This checklist describes the loaded saved scope. It does not approve, close, reopen or sign off anything. Use the controls linked below to inspect each step.</p>
    {review.snapshot ? <p style={{ fontSize: 12 }}>Saved snapshot: {formatAustralianTimestamp(review.snapshot.snapshotAt)} · Recorded variance: {formatMoneyCentsExact(review.snapshot.varianceCents, review.snapshot.currency)} · Unresolved items: {review.snapshot.unresolvedItemCount}.</p> : null}
    {review.next?<div style={{border:'1px solid var(--border)',borderRadius:8,padding:12,marginBlock:12}}>
      <h3 style={{fontSize:14,marginTop:0}}>Suggested next inspection · {review.next.state}</h3>
      <p style={{fontSize:13}}>{review.next.detail}</p>
      <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12}}>
        <a href={review.next.href}>{review.next.action}</a>
        {review.snapshot&&props.onInspectSnapshot?<button type="button" onClick={event=>{if(review.snapshot)props.onInspectSnapshot?.(review.snapshot,event.currentTarget);}} {...buttonProps('secondary','sm')}>Inspect selected snapshot evidence</button>:null}
      </div>
    </div>:null}
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Only the selected source and currency are described. Other comparisons and server close checks remain separate. A suggestion is not confirmation that an action is permitted.</p>
    <details><summary>View checklist and linked controls</summary>
    <ol style={{ paddingLeft: 22, display: 'grid', gap: 14 }}>
      {review.steps.map(step => <li key={step.title}>
        <div><strong>{step.title}</strong> · {step.state}</div>
        <p style={{ margin: '4px 0', fontSize: 13, overflowWrap: 'anywhere' }}>{step.detail}</p>
        <a href={step.href}>{step.action}</a>
      </li>)}
    </ol>
    </details>
  </section>;
}
