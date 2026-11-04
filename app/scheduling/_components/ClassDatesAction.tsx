'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/app';

interface Receipt { created: { id: string; date: string }[]; skipped: { date: string; reason: string }[]; existing: number }
const changed='coaching-generation-storage';
const unavailable=':unavailable:';
const subscribe=(notify:()=>void)=>{window.addEventListener(changed,notify);window.addEventListener('storage',notify);return()=>{window.removeEventListener(changed,notify);window.removeEventListener('storage',notify);};};
const serverSnapshot=()=>undefined;
function receipt(value: unknown): value is Receipt {
  const r=value as Receipt | null;
  return !!r && Array.isArray(r.created) && Array.isArray(r.skipped) && Number.isInteger(r.existing)
    && r.created.every(x=>typeof x?.id==='string' && typeof x.date==='string') && r.skipped.every(x=>typeof x?.date==='string' && typeof x.reason==='string');
}
export function ClassDatesAction({ offeringId, name, onGenerated }: { offeringId: string; name: string; onGenerated: () => void }) {
  const storageKey=`coaching-class-generation:${offeringId}`;
  const url=`/api/scheduling/offerings/${encodeURIComponent(offeringId)}/generate-classes`;
  const snapshot=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(storageKey);}catch{return unavailable;}},serverSnapshot);
  const ready=snapshot!==undefined && snapshot!==unavailable;
  const pending=ready ? snapshot : null;
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const inFlight=useRef(false);
  const saveKey=(key:string|null)=>{if(key)sessionStorage.setItem(storageKey,key);else sessionStorage.removeItem(storageKey);window.dispatchEvent(new Event(changed));};
  const finish=(result:Receipt)=>{
    saveKey(null);
    const gaps=result.skipped.filter(x=>x.reason==='nonexistent_local_time').map(x=>x.date);
    setMessage(`${result.created.length} new ${result.created.length === 1 ? 'date' : 'dates'} saved. Existing and cancelled dates were kept.${gaps.length ? ` No class was created at the unavailable daylight-saving time on ${gaps.join(', ')}.` : ''}`);
    onGenerated();
  };
  async function act() {
    if (inFlight.current || !ready) return;
    inFlight.current=true; setBusy(true); setMessage('');
    let key=pending;
    try {
      if (key) {
        const response=await fetch(`${url}?key=${encodeURIComponent(key)}`,{cache:'no-store'});
        const data=await response.json();
        if (!response.ok || !receipt(data.result)) { setMessage('The saved result is not confirmed yet. Check again before creating any more dates.'); return; }
        finish(data.result); return;
      }
      key=crypto.randomUUID(); saveKey(key);
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idempotencyKey:key})});
      const data=await response.json();
      if (response.ok && receipt(data)) { finish(data); return; }
      if ([400,401,403,413,415].includes(response.status) || ['COACHING_NOT_READY','CLASS_CHANGED','ORIGIN_DENIED','INVALID_INPUT'].includes(data.code)) {
        saveKey(null);
        setMessage(data.code==='COACHING_NOT_READY' ? 'Creating dates here is not available yet.' : 'The request was refused. Reload the class before trying again.');
      } else setMessage('The save could not be confirmed. Check the saved result before creating more dates.');
    } catch { setMessage('The save could not be confirmed. Check the saved result before creating more dates.'); }
    finally { inFlight.current=false; setBusy(false); }
  }
  return <span>
    <Button size="sm" disabled={!ready || busy} onClick={act} aria-label={`${pending ? 'Check saved dates' : 'Create upcoming dates'} for ${name}`}>
      {busy ? 'Checking…' : pending ? 'Check saved dates' : 'Create upcoming dates'}
    </Button>
    {message && <span role="status">{message}</span>}
    {snapshot===unavailable && <span role="status">Your browser could not preserve this request. Reload before creating dates.</span>}
  </span>;
}
