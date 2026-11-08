'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/app';
import type { CoachingAction } from '@/lib/scheduling/coachingContract';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';
import layout from './coaching.module.css';

interface ClassDate { id:string; name:string; date:string; startTime:string; status:string; archived:boolean; enrolled:number; capacity:number }
interface Dates { phase:'legacy'|'frozen'|'scheduling'; dates:ClassDate[]; next:string|null }
interface Row { id:string; name:string; email:string|null; status:string; attendance:string|null; attendanceVersion:number|null; paidMarker:boolean; markerVersion:number|null; historyOnly:boolean; priceCents:number|null; currency:string; seriesId?:string|null;seriesStatus?:string|null;pauses?:{id:string;from:string;until:string}[] }
interface Roster { occurrence:{name:string;date:string;startTime:string;status:string}; rows:Row[]; next:string|null }
interface Pending { key:string; kind:CoachingAction['kind']; bookingId?:string }
const event='coaching-roster-pending';
const subscribe=(fn:()=>void)=>{window.addEventListener(event,fn);window.addEventListener('storage',fn);return()=>{window.removeEventListener(event,fn);window.removeEventListener('storage',fn);};};
const serverSnapshot=()=>undefined;
function plusDays(date:string,days:number) { const value=new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10); }
function dayLabel(date:string) {
  return new Intl.DateTimeFormat('en-AU',{weekday:'long',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
}

export default function CoachingWorkspaceScreen({today}:{today:string}) {
  const [from,setFrom]=useState(today); const [until,setUntil]=useState(plusDays(today,28));
  const [range,setRange]=useState({from:today,until:plusDays(today,28)});
  const [after,setAfter]=useState<string|null>(null); const [selected,setSelected]=useState<string|null>(null);
  function showRange(nextFrom:string,nextUntil:string) {
    setFrom(nextFrom);setUntil(nextUntil);setAfter(null);setSelected(null);setRange({from:nextFrom,until:nextUntil});
  }
  const data=useSchedulingData<Dates>(`/coaching?from=${range.from}&until=${range.until}${after ? `&after=${encodeURIComponent(after)}`:''}`);
  const days=new Map<string,ClassDate[]>();
  for(const date of [...(data.data?.dates ?? [])].sort((a,b)=>(a.date+a.startTime+a.id).localeCompare(b.date+b.startTime+b.id))) {
    days.set(date.date,[...(days.get(date.date) ?? []),date]);
  }
  return <div className={`${styles.page} ${layout.workspace}`}>
    <header className={layout.header}><div><p className={layout.eyebrow}>SCHEDULE & ATTENDANCE</p><h1>Coaching roster</h1><p>Choose a class date to view players and manage attendance.</p></div><Link href="/scheduling/schedules/tennis-coaching">Manage classes and restore archived classes</Link></header>
    <section className={layout.period} aria-label="Schedule dates">
    <nav className={layout.toolbar} aria-label="Tennis schedule periods">
      <Button onClick={()=>showRange(plusDays(range.from,-28),plusDays(range.from,-1))}>Previous schedule</Button>{' '}
      <Button onClick={()=>showRange(plusDays(range.until,1),plusDays(range.until,28))}>Next schedule</Button>{' '}
      <Button onClick={()=>showRange(today,plusDays(today,28))}>Upcoming schedule</Button>
    </nav>
    <p role="status" className={layout.range}>Showing {range.from} to {range.until}. Previous schedules keep their original bookings and attendance.</p>
    <form className={layout.dateForm} onSubmit={e=>{e.preventDefault();setAfter(null);setSelected(null);setRange({from,until});}}>
      <label>From <input type="date" required value={from} onChange={e=>setFrom(e.target.value)} /></label>{' '}
      <label>Until <input type="date" required min={from} max={plusDays(from || today,70)} value={until} onChange={e=>setUntil(e.target.value)} /></label>{' '}
      <Button type="submit">Show dates</Button>
    </form>
    </section>
    {data.problem ? <div role="alert">Class dates could not be refreshed. <Button onClick={data.reload}>Try again</Button></div> : data.state==='loading' ? <p role="status">Loading class dates…</p> : null}
    {data.data?.phase==='legacy' && <p>Coaching is still using its current workspace. <Link href="/business/tennis/coaching">Open Tennis coaching</Link>.</p>}
    {data.data?.phase==='frozen' && <p role="status">Coaching is paused for its handover. History is available; changes are disabled.</p>}
    {!data.problem && data.data?.phase!=='legacy' && <div className={layout.columns}>
      <section aria-label="Class dates" className={layout.agenda} aria-busy={data.refreshing}>
      <div className={layout.agendaHead}><h2>Class dates</h2><span>{data.data?.dates.length ?? 0} on this page</span></div>
      {[...days].map(([date,dates])=><section key={date} className={layout.day} aria-label={dayLabel(date)}>
        <h3><time dateTime={date}>{dayLabel(date)}</time>{date===today && <span className={layout.badge}>Today</span>}</h3>
        <ul className={layout.sessionList}>{dates.map(d=><li key={d.id}>
          <button type="button" className={layout.session} aria-pressed={selected===d.id} aria-label={`${d.date} ${d.startTime} — ${d.name}`} onClick={()=>setSelected(d.id)}>
            <time dateTime={`${d.date}T${d.startTime}`}>{d.startTime}</time><span className={layout.sessionName}>{d.name}<small>{d.archived ? 'Archived class · ':''}{d.status!=='scheduled' ? d.status:'Scheduled'}</small></span>
            <span className={layout.capacity}>{d.enrolled}/{d.capacity}<small>{d.enrolled>=d.capacity ? 'Full':'places'}</small></span>
          </button>
        </li>)}</ul>
      </section>)}
      {data.data?.dates.length===0 && <p className={layout.empty}>No class dates in this range. Choose another period above.</p>}
      <div className={layout.toolbar}>{after && <Button onClick={()=>{setAfter(null);setSelected(null);}}>First dates</Button>}
      {data.data?.next && <Button onClick={()=>{setAfter(data.data!.next);setSelected(null);}}>More dates</Button>}</div>
      </section>
      <div className={layout.rosterColumn}>
      {selected ? <TennisRoster key={selected} id={selected} active={data.data?.phase==='scheduling' && !data.refreshing} today={today} onChanged={data.reload} />
        : <section className={layout.empty} aria-label="Roster selection"><h2>Select a class date</h2><p>Choose a session to see its players, attendance and weekly enrolments.</p></section>}
      </div>
    </div>}
  </div>;
}

type RosterProps = { id: string; active: boolean; today: string };

export function RosterScreen(props: RosterProps) {
  const router = useRouter();
  return <TennisRoster {...props} onChanged={() => router.refresh()} />;
}

function TennisRoster({id,active,today,onChanged}: RosterProps & {onChanged:()=>void}) {
  const [after,setAfter]=useState<string|null>(null);
  const data=useSchedulingData<Roster>(`/coaching/roster/${encodeURIComponent(id)}${after ? `?after=${encodeURIComponent(after)}`:''}`);
  const roster=data.data;
  const storageKey=`coaching-roster:${id}`;
  const snapshot=useSyncExternalStore(subscribe,()=>{try{return sessionStorage.getItem(storageKey);}catch{return ':unavailable:';}},serverSnapshot);
  let pending:Pending|null=null; let storageReady=snapshot!==undefined && snapshot!==':unavailable:';
  try { if(snapshot && storageReady) {const p=JSON.parse(snapshot);if(!p || typeof p.key!=='string' || !['enrol','attendance','paid-marker','cancel','pause','resume','start-weekly','stop-weekly'].includes(p.kind)) throw Error();pending=p;} } catch {storageReady=false;}
  const [busy,setBusy]=useState(false);const flight=useRef(false);const [message,setMessage]=useState('');
  const save=(value:Pending|null)=>{if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);window.dispatchEvent(new Event(event));};
  const reload=()=>{data.reload();onChanged();};
  const disabled=!active || !storageReady || busy || !!pending || !!data.problem || data.refreshing;
  async function act(action:CoachingAction) {
    if(disabled || flight.current)return;flight.current=true;setBusy(true);setMessage('');
    try {
      save({key:action.idempotencyKey,kind:action.kind,...('bookingId' in action ? {bookingId:action.bookingId}:{})});
      const response=await fetch('/api/scheduling/coaching/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(action)});
      const body=await response.json();
      if(response.ok && Object.hasOwn(body,'result')) {
        save(null);setMessage(body.result?.ok===false ? `Not saved: ${body.result.code}. Reload the roster before trying again.`:'Saved.');reload();
      } else if([400,401,403,409,413,415].includes(response.status) || body.code==='COACHING_NOT_READY') {
        save(null);setMessage('The request was refused. Reload the roster before making another change.');data.reload();
      } else setMessage('The save is not confirmed. Check the saved request before changing anything else.');
    } catch {setMessage('The save is not confirmed. Check the saved request before changing anything else.');}
    finally{flight.current=false;setBusy(false);}
  }
  async function recover() {
    if(!pending || flight.current)return;flight.current=true;setBusy(true);
    try {
      const q=new URLSearchParams({key:pending.key,kind:pending.kind,...(pending.bookingId ? {bookingId:pending.bookingId}:{})});
      const response=await fetch(`/api/scheduling/coaching/actions?${q}`,{cache:'no-store'});const body=await response.json();
      if(response.ok && body.confirmed===true){save(null);setMessage('The saved change is confirmed.');reload();}
      else setMessage('There is no confirmed result yet. This does not prove the change failed. Check again before repeating it.');
    } catch{setMessage('The saved request could not be checked. Try checking again.');}
    finally{flight.current=false;setBusy(false);}
  }
  const key=()=>crypto.randomUUID();
  return <section aria-label="Class roster" className={layout.roster}>
    <h2>{roster?.occurrence.name ?? 'Class roster'}</h2>
    {data.problem && <div role="alert">The roster could not be refreshed. Saved rows are hidden until access and the current state are confirmed. <Button onClick={data.reload}>Reload roster</Button></div>}
    {!storageReady && <p role="alert">Your browser cannot preserve this request. Changes are disabled.</p>}
    {pending && <Button disabled={busy} onClick={recover}>Check saved request</Button>}
    {message && <p role="status">{message}</p>}
    {!data.problem && roster && <>
      <p>{roster.occurrence.date} {roster.occurrence.startTime} · {roster.occurrence.status}</p>
      <p className={layout.note}>Manual paid markers do not record a Commercial payment.</p>
      <ul className={layout.players}>{roster.rows.map(row=><li key={row.id}>
        <strong>{row.name}</strong>{row.email ? ` · ${row.email}`:''} · {row.status} · {row.attendance ?? 'Attendance not marked'} · {row.paidMarker ? 'Marked paid':'Not marked paid'}
        {row.priceCents===null && <span> · Historical price not recorded</span>}
        {row.historyOnly ? <span> · Original history (read only)</span> : row.status!=='cancelled' && <div className={layout.playerActions}>
          <Button disabled={disabled} onClick={()=>act({kind:'attendance',bookingId:row.id,value:'attended',expectedVersion:row.attendanceVersion!,idempotencyKey:key()})}>Here</Button>{' '}
          <Button disabled={disabled} onClick={()=>act({kind:'attendance',bookingId:row.id,value:'absent',expectedVersion:row.attendanceVersion!,idempotencyKey:key()})}>Absent</Button>{' '}
          <Button disabled={disabled} onClick={()=>act({kind:'attendance',bookingId:row.id,value:null,expectedVersion:row.attendanceVersion!,idempotencyKey:key()})}>Clear attendance</Button>{' '}
          <Button disabled={disabled} onClick={()=>act({kind:'paid-marker',bookingId:row.id,paid:!row.paidMarker,expectedVersion:row.markerVersion!,idempotencyKey:key()})}>{row.paidMarker ? 'Clear paid marker':'Mark paid'}</Button>{' '}
          <Button disabled={disabled || row.paidMarker || row.attendance!==null} onClick={()=>{if(window.confirm(`Cancel ${row.name}'s booking for this date?`))void act({kind:'cancel',bookingId:row.id,idempotencyKey:key()});}}>Cancel booking</Button>
        </div>}
        {!row.historyOnly && <WeeklyControls row={row} disabled={disabled} today={today} bookingDate={roster.occurrence.date} act={act} />}
        {!disabled && !row.historyOnly && row.status!=='cancelled' && roster.occurrence.status==='scheduled' && <p><Link href={`/commercial/invoices/new?${new URLSearchParams({coachingDate:id,coachingBooking:row.id,...(after ? {coachingAfter:after}:{})})}`}>Review for invoicing</Link></p>}
      </li>)}</ul>
      {roster.rows.length===0 && <p>No players on this date.</p>}
      {after && <Button onClick={()=>setAfter(null)}>First players</Button>}
      {roster.next && <Button onClick={()=>setAfter(roster!.next)}>More players</Button>}
      <form className={layout.enrolForm} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act({kind:'enrol',occurrenceId:id,idempotencyKey:key(),name:String(f.get('name')),email:String(f.get('email'))||null,phone:String(f.get('phone'))||null,notes:null,weekly:f.get('weekly')==='on',until:String(f.get('until'))});}}>
        <fieldset disabled={disabled || roster.occurrence.status!=='scheduled' || roster.occurrence.date<today}>
          <legend>Add a player</legend>
          <label>Name <input name="name" required maxLength={200} /></label>{' '}
          <label>Email <input name="email" type="email" maxLength={320} /></label>{' '}
          <label>Phone <input name="phone" maxLength={80} /></label>{' '}
          <label><input name="weekly" type="checkbox" /> Weekly enrolment</label>{' '}
          <label>Book through <input name="until" type="date" required min={roster.occurrence.date} max={plusDays(roster.occurrence.date,70)} defaultValue={plusDays(roster.occurrence.date,70)} /></label>{' '}
          <Button type="submit">Enrol player</Button>
        </fieldset>
      </form>
    </>}
  </section>;
}

function WeeklyControls({row,disabled,today,bookingDate,act}:{row:Row;disabled:boolean;today:string;bookingDate:string;act:(action:CoachingAction)=>Promise<void>}) {
  const minimum=!row.seriesId && bookingDate>today ? bookingDate:today;
  const [from,setFrom]=useState(minimum);const [until,setUntil]=useState(plusDays(minimum,7));
  if(row.seriesId?.startsWith('coach-term:'))return <p>Term enrolment</p>;
  if(row.seriesId && row.seriesStatus!=='active')return <p>Weekly enrolment has ended. Previous bookings remain in history.</p>;
  if(!row.seriesId && row.status==='cancelled')return null;
  return <details><summary>Weekly enrolment for {row.name}</summary>
    <form onSubmit={e=>{e.preventDefault();void act(row.seriesId ? {kind:'pause',seriesId:row.seriesId,from,until,reason:null,idempotencyKey:crypto.randomUUID()} : {kind:'start-weekly',bookingId:row.id,from,until,idempotencyKey:crypto.randomUUID()});}}>
      <fieldset disabled={disabled}>
        <label>From <input type="date" required min={minimum} value={from} onChange={e=>setFrom(e.target.value)} /></label>{' '}
        <label>Until <input type="date" required min={from} max={plusDays(from || today,row.seriesId ? 366:70)} value={until} onChange={e=>setUntil(e.target.value)} /></label>{' '}
        <Button type="submit">{row.seriesId ? 'Pause weekly enrolment':'Make weekly'}</Button>
        {row.seriesId && <Button type="button" onClick={()=>{if(window.confirm(`Stop ${row.name}'s weekly enrolment after ${from}? Protected bookings will be kept.`))void act({kind:'stop-weekly',seriesId:row.seriesId!,after:from,idempotencyKey:crypto.randomUUID()});}}>Stop weekly after this date</Button>}
      </fieldset>
    </form>
    {(row.pauses ?? []).map(p=><p key={p.id}>Paused {p.from} to {p.until}{' '}<Button disabled={disabled} onClick={()=>act({kind:'resume',seriesId:row.seriesId!,pauseId:p.id,from:today,until:plusDays(today,70),idempotencyKey:crypto.randomUUID()})}>Resume this pause</Button></p>)}
  </details>;
}
