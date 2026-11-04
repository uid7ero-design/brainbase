'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {Button} from '@/components/ui/app';
import {formatMoneyCentsExact} from '@/lib/commercial/money';

interface Source {
  occurrence: {name:string;date:string;startTime:string;status:string};
  rows: {id:string;name:string;status:string;historyOnly:boolean;attendance:string|null;paidMarker:boolean;priceCents:number|null;currency:string}[];
}
const validId=(value:string)=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

/** Read-only preparation. The existing tenant-bound roster route remains the
 * authority. No payer matching, invoice lines, issuance or payments are inferred. */
export default function CoachingInvoicePreparation({occurrenceId,bookingId,after,onUseNotes}:{occurrenceId:string;bookingId:string;after:string|null;onUseNotes:(notes:string)=>void}) {
  const [source,setSource]=useState<Source|null>(null);
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    async function read() {
      try {
        if(!validId(occurrenceId) || !validId(bookingId) || (after!==null && !validId(after)))throw Error();
        const response=await fetch(`/api/scheduling/coaching/roster/${encodeURIComponent(occurrenceId)}${after ? `?after=${encodeURIComponent(after)}`:''}`,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error();
        const data:Source=await response.json();
        const row=data.rows?.find(r=>r.id===bookingId);
        if(!row || row.historyOnly || row.status==='cancelled' || data.occurrence?.status!=='scheduled'
          || typeof row.name!=='string' || typeof data.occurrence.name!=='string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(data.occurrence.date)
          || !/^[A-Z]{3}$/.test(row.currency)
          || (row.priceCents!==null && (!Number.isSafeInteger(row.priceCents) || row.priceCents<0)))throw Error();
        if(!controller.signal.aborted)setSource(data);
      } catch {if(!controller.signal.aborted)setError(true);}
    }
    void read();return()=>controller.abort();
  },[occurrenceId,bookingId,after,attempt]);
  const row=source?.rows.find(r=>r.id===bookingId);
  const price=row?.priceCents==null ? 'Historical price not recorded — confirm the agreed charge.' : `${formatMoneyCentsExact(String(row.priceCents),row.currency)} ${row.currency} recorded booking price — confirm tax treatment.`;
  return <section aria-label="Booking invoice preparation" style={{border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',background:'var(--bg-surface)',padding:20,marginBottom:20}}>
    <h2>Review booking for invoicing</h2>
    {error ? <div role="alert"><p>This booking could not be confirmed for invoicing. Return to the roster to check its current status and your access.</p><Button onClick={()=>{setSource(null);setError(false);setAttempt(n=>n+1);}}>Check booking again</Button></div>
      : !row || !source ? <p role="status">Checking the current booking…</p> : <>
        <p><strong>{source.occurrence.name}</strong><br/>{source.occurrence.date} · {source.occurrence.startTime.slice(0,5)} · {row.name}</p>
        <p>{price}</p><p>Attendance: {row.attendance ?? 'not marked'}. Tennis paid marker: {row.paidMarker ? 'marked':'not marked'} — this is not a Commercial payment.</p>
        <p>Select the billing customer below; a player and their paying parent may be different people. Check existing invoices before creating another. Add and review the lesson line items after creating the draft.</p>
        <Button onClick={()=>onUseNotes(`Coaching booking reference: ${bookingId}\nClass date reference: ${occurrenceId}\n${source.occurrence.name} — ${source.occurrence.date} ${source.occurrence.startTime.slice(0,5)}\nPlayer: ${row.name}\n${price}`)}>Use booking reference in internal notes</Button>
      </>}
    <p><Link href="/commercial/invoices" target="_blank" rel="noopener noreferrer">Review existing invoices (new tab)</Link> · <Link href="/scheduling/coaching">Back to roster</Link></p>
    <p>No invoice lines or payments are created from this reference. Booking changes do not update invoice notes automatically.</p>
  </section>;
}
