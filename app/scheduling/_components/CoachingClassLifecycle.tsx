'use client';
import {useRef,useState,useSyncExternalStore} from 'react';
import {Button} from '@/components/ui/app';
const event='coaching-class-change';
const subscribe=(fn:()=>void)=>{window.addEventListener(event,fn);window.addEventListener('storage',fn);return()=>{window.removeEventListener(event,fn);window.removeEventListener('storage',fn);};};
const serverSnapshot=()=>undefined;
export function CoachingClassLifecycle({id,name,archived,onChanged}:{id:string;name:string;archived:boolean;onChanged:()=>void}) {
  const storage=`coaching-class-change:${id}`;const url=`/api/scheduling/offerings/${encodeURIComponent(id)}/coaching-lifecycle`;
  const snapshot=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(storage);}catch{return ':unavailable:';}},serverSnapshot);
  let pending:{key:string;action:string}|null=null;let ready=snapshot!==undefined && snapshot!==':unavailable:';
  try{if(snapshot && ready){pending=JSON.parse(snapshot);if(!pending || !['archive','restore'].includes(pending.action) || typeof pending.key!=='string')throw Error();}}catch{ready=false;}
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const flight=useRef(false);
  const save=(value:unknown|null)=>{if(value)sessionStorage.setItem(storage,JSON.stringify(value));else sessionStorage.removeItem(storage);window.dispatchEvent(new Event(event));};
  async function act(){
    if(!ready || flight.current)return;
    if(!pending && !window.confirm(archived ? `Restore ${name} as a new active class? Its old bookings and cancellations will stay in history. Active weekly enrolments and pauses will be carried forward; protected future dates stay with the original class.` : `Archive ${name}? Future unpaid bookings without attendance will be cancelled. Paid or attended bookings will be kept.`))return;
    flight.current=true;setBusy(true);
    try{
      const request=pending ?? {key:crypto.randomUUID(),action:archived ? 'restore':'archive'};
      if(!pending)save(request);
      const response=await fetch(pending ? `${url}?key=${encodeURIComponent(request.key)}&action=${request.action}` : url,pending ? {cache:'no-store'} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:request.action,idempotencyKey:request.key})});
      const body=await response.json();
      if(response.ok && body.result?.offeringId){save(null);setMessage(request.action==='restore' ? 'Class restored. Original history is unchanged. Review the new roster for full or paused dates.' : `Class archived. ${body.result.protected?.length ?? 0} protected bookings were kept.`);onChanged();}
      else if(!pending && ([400,401,403,409,413,415].includes(response.status) || body.code==='COACHING_NOT_READY')){save(null);setMessage(body.error ?? 'The class change was refused. Reload before trying again.');}
      else setMessage('The result is not confirmed. Check the saved request before repeating this change.');
    }catch{setMessage('The result is not confirmed. Check the saved request before repeating this change.');}
    finally{flight.current=false;setBusy(false);}
  }
  return <span><Button size="sm" disabled={!ready || busy} onClick={act} aria-label={`${pending ? 'Check saved class change for' : archived ? 'Restore' : 'Archive'} ${name}`}>{pending ? 'Check saved class change':archived ? 'Restore':'Archive'}</Button>{message && <span role="status">{message}</span>}</span>;
}
