'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import { Upload, Truck, DollarSign, BarChart2, AlertCircle, Gauge, Activity, Shield, Clock, Users, MapPin, Wrench } from 'lucide-react';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, InsightCard } from '@/components/dashboard/DashboardShell';
import { useDashboardChart, type DashboardChart } from '@/components/dashboard/ui/chartTheme';
import { TONE, tint, type Tone } from '@/components/dashboard/ui/tokens';
import { buttonProps } from '@/components/ui/app';
import type { FleetUploadMeta } from './page';
import { HlnaInsightBanner } from '@/components/hlna/InsightBanner';

// ─── Constants ────────────────────────────────────────────────────────────────
//
// Authenticated visual-completion pass: every colour is a theme token (HTML)
// or a key into the theme-aware chart palette (SVG, via useDashboardChart), so
// the fleet dashboard reads in light AND dark. The category encodings below
// are kept (each category keeps its own distinct series colour); semantic
// states (OK / due soon / overdue, over/under threshold) use the status
// tones, and text on tinted chips uses text/status tokens, never a raw hue.

type PalKey = 'primary' | 'secondary' | 'comparison' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const C: Record<string, PalKey> = { wages:'primary', fuel:'info', maintenance:'warning', rego:'comparison', repairs:'danger', insurance:'success', depreciation:'neutral' };
const DEPT_C: Record<string, PalKey> = { 'Waste Collection':'info','Parks & Gardens':'success','Roads & Drainage':'warning','Customer Service':'primary','Facilities':'danger' };
const STATUS_C: Record<string, Tone> = { OK:'success','Due Soon':'warning',Overdue:'danger' };
const CAT_C: Record<string, PalKey> = { Breakdown:'danger',Scheduled:'warning',Accident:'secondary',External:'neutral' };
const CAT_TONE: Record<string, Tone> = { Breakdown:'danger',Scheduled:'warning',Accident:'info',External:'inactive' };
const ACCENT: Record<string, Tone | 'accent'> = { blue:'info',emerald:'success',violet:'accent',amber:'warning',red:'danger',slate:'inactive' };
const STOP_C: Record<string, PalKey> = { 'Collection':'primary','Transfer Station':'secondary','Fuel Stop':'warning','Rest Break':'neutral','Depot Check-in':'success','Site Inspection':'info','Maintenance Work':'danger','Road Works':'warning','Customer Site':'success','Lunch Break':'comparison','Maintenance Stop':'danger' };
const COST_KEYS = ['wages','fuel','maintenance','repairs','insurance','rego'] as const;

const pc = (chart: DashboardChart, key: PalKey | undefined) => chart.palette[key ?? 'neutral'];

const fmt  = (n:number) => `$${Number(n).toLocaleString('en-AU',{maximumFractionDigits:0})}`;
const fmtH = (n:number) => `${Number(n).toLocaleString('en-AU')} hrs`;
const fmtK = (n:number) => `${Number(n).toLocaleString('en-AU')} km`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Asset       = { id:string;type:string;make:string;year:number;department:string;driver:string;km:number;wages:number;fuel:number;maintenance:number;rego:number;repairs:number;insurance:number;depreciation:number;services:number;defects:number;total:number;totalWithDepr:number;costPerKm:number };
type SvcRecord   = { asset:string;make:string;lastService:string;nextDue:string;odometer:number;serviceType:string;cost:number;status:string;notes:string };
type HRRecord    = { asset:string;driver:string;department:string;scheduledHours:number;workedHours:number;overtime:number;absentDays:number;hourlyRate:number;totalLabour:number };
type DtRecord    = { asset:string;date:string;category:string;reason:string;hours:number;cost:number;resolved:boolean };
type UtilRecord  = { asset:string;type:string;scheduledHours:number;operatingHours:number;idleHours:number;utilisationPct:number;idleCost:number };
type TripRecord  = { asset:string;driver:string;date:string;yardDep:string;yardRet:string;hoursOut:number;stopsMade:number;areasVisited:string };
type StopRecord  = { asset:string;driver:string;date:string;area:string;arrival:string;departure:string;durationMins:number;stopType:string };
type ColocRecord = { date:string;area:string;vehicles:string;startTime:string;durationMins:number;notes:string };

const R = (json:Record<string,unknown>[]) => json;
const parseAssets = (rows:Record<string,unknown>[]): Asset[] => rows.map(r=>{ const wages=+r.Wages!||0,fuel=+r.Fuel!||0,maint=+r.Maintenance!||0,rego=+r.Rego!||0,repairs=+r.Repairs!||0,ins=+r.Insurance!||0,depr=+r.Depreciation!||0,km=+r.KM!||0; const total=wages+fuel+maint+rego+repairs+ins; return {id:String(r.Asset),type:String(r.Type||''),make:String(r.Make||''),year:+r.Year!||0,department:String(r.Department||''),driver:String(r.Driver||''),km,wages,fuel,maintenance:maint,rego,repairs,insurance:ins,depreciation:depr,services:+r.Services!||0,defects:+r.Defects!||0,total,totalWithDepr:total+depr,costPerKm:km>0?total/km:0}; });
const parseSvc   = (rows:Record<string,unknown>[]): SvcRecord[] => rows.map(r=>({asset:String(r.Asset),make:String(r.Make||''),lastService:String(r['Last Service']||''),nextDue:String(r['Next Due']||''),odometer:+r.Odometer!||0,serviceType:String(r['Service Type']||''),cost:+r.Cost!||0,status:String(r.Status||'OK'),notes:String(r.Notes||'')}));
const parseHR    = (rows:Record<string,unknown>[]): HRRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),department:String(r.Department||''),scheduledHours:+r['Scheduled Hours']!||0,workedHours:+r['Worked Hours']!||0,overtime:+r.Overtime!||0,absentDays:+r['Absent Days']!||0,hourlyRate:+r['Hourly Rate']!||0,totalLabour:+r['Total Labour']!||0}));
const parseDt    = (rows:Record<string,unknown>[]): DtRecord[]  => rows.map(r=>({asset:String(r.Asset),date:String(r.Date||''),category:String(r.Category||''),reason:String(r.Reason||''),hours:+r.Hours!||0,cost:+r.Cost!||0,resolved:String(r.Resolved||'Yes').toLowerCase()==='yes'}));
const parseUtil  = (rows:Record<string,unknown>[]): UtilRecord[]  => rows.map(r=>({asset:String(r.Asset),type:String(r.Type||''),scheduledHours:+r['Scheduled Hours']!||0,operatingHours:+r['Operating Hours']!||0,idleHours:+r['Idle Hours']!||0,utilisationPct:+r['Utilisation %']!||0,idleCost:+r['Idle Cost']!||0}));
const parseTrips = (rows:Record<string,unknown>[]): TripRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),date:String(r.Date||''),yardDep:String(r['Yard Departure']||''),yardRet:String(r['Yard Return']||''),hoursOut:+r['Hours Out']!||0,stopsMade:+r['Stops Made']!||0,areasVisited:String(r['Areas Visited']||'')}));
const parseStops = (rows:Record<string,unknown>[]): StopRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),date:String(r.Date||''),area:String(r.Area||''),arrival:String(r.Arrival||''),departure:String(r.Departure||''),durationMins:+r['Duration (mins)']!||0,stopType:String(r['Stop Type']||'')}));
const parseColoc = (rows:Record<string,unknown>[]): ColocRecord[] => rows.map(r=>({date:String(r.Date||''),area:String(r.Area||''),vehicles:String(r.Vehicles||''),startTime:String(r['Start Time']||''),durationMins:+r['Duration (mins)']!||0,notes:String(r.Notes||'')}));

// ─── Shared sub-components ────────────────────────────────────────────────────

const DARK_CARD = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:20 } as React.CSSProperties;
const T1 = 'var(--text-primary)', T2 = 'var(--text-secondary)', T3 = 'var(--text-muted)';
function KPI2({icon,label,value,sub,accent}:{icon:React.ReactNode;label:string;value:string;sub?:string;accent:string}) {
  const a = ACCENT[accent] ?? 'inactive';
  const fg = a === 'accent' ? 'var(--brand-brainbase-accent)' : TONE[a].fg;
  const bg = a === 'accent' ? 'var(--brand-brainbase-accent-muted)' : TONE[a].muted;
  return (
    <div style={DARK_CARD}>
      <div style={{marginBottom:12}}><span aria-hidden="true" className="inline-flex p-2 rounded-lg" style={{background:bg,color:fg}}>{icon}</span></div>
      <p style={{fontSize:11,fontWeight:600,color:T3,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{label}</p>
      <p style={{fontSize:20,fontWeight:700,color:T1,lineHeight:1.2,fontVariantNumeric:'tabular-nums'}}>{value}</p>
      {sub&&<p style={{fontSize:11,color:T3,marginTop:2}}>{sub}</p>}
    </div>
  );
}
function SecTitle({children}:{children:React.ReactNode}){return<p style={{fontSize:11,fontWeight:600,color:T2,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:14}}>{children}</p>;}
function THead({cols}:{cols:string[]}){return<thead><tr style={{background:'var(--bg-sunken)',borderBottom:'1px solid var(--border)'}}>{cols.map(h=><th key={h} scope="col" style={{padding:'10px 16px',textAlign:'left',fontSize:11,fontWeight:600,color:T2,textTransform:'uppercase',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>;}
function TR({children}:{children:React.ReactNode;i:number}){return<tr style={{borderBottom:'1px solid var(--border)'}}>{children}</tr>;}
function TD({children,bold}:{children:React.ReactNode;bold?:boolean}){return<td style={{padding:'10px 16px',fontWeight:bold?700:400,color:bold?T1:T2,fontSize:13}}>{children}</td>;}
/** Semantic status chip: written label on a status tint, text in the status token (AA). */
function Badge({label,tone}:{label:string;tone:Tone}){const t=TONE[tone];return<span style={{padding:'2px 8px',borderRadius:'var(--radius-sm)',fontSize:11,fontWeight:600,background:t.muted,color:t.fg,border:`1px solid ${t.border}`,whiteSpace:'nowrap'}}>{label}</span>;}
/** Category chip: the category hue as a dot, the label in a text token. */
function DotChip({label,color}:{label:string;color:string}){return<span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'2px 8px',borderRadius:'var(--radius-sm)',fontSize:11,fontWeight:500,background:tint(color,12),border:'1px solid var(--border)',color:T1,whiteSpace:'nowrap'}}><span aria-hidden="true" style={{width:7,height:7,borderRadius:'50%',background:color,flexShrink:0}}/>{label}</span>;}
function Empty(){return(<div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'120px 20px',textAlign:'center'}}><div aria-hidden="true" style={{background:'var(--bg-sunken)',border:'1px solid var(--border)',padding:20,borderRadius:'var(--radius-lg)',marginBottom:16,color:T3}}><Truck size={36}/></div><h2 style={{fontSize:18,fontWeight:600,color:T1,marginBottom:8}}>No Fleet Data Loaded</h2><p style={{color:T2,fontSize:13,marginBottom:16}}>Upload the multi-sheet Excel file to get started.</p><a href="/fleet-dummy-data.xlsx" download {...buttonProps('secondary')}>Download Sample Data</a></div>);}

function FleetDataBanner({ meta }: { meta: FleetUploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div style={{ background: TONE.success.muted, border: `1px solid ${TONE.success.border}`, borderRadius: 'var(--radius-lg)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <span style={{ background: 'var(--bg-surface)', color: TONE.success.fg, border: `1px solid ${TONE.success.border}`, borderRadius: 'var(--radius-sm)', padding: '2px 9px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Live Data</span>
      <span style={{ fontSize: 13, color: T2 }}>
        <span style={{ color: T1, fontWeight: 600 }}>{meta.fileName}</span>
        <span aria-hidden="true" style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>{meta.recordCount.toLocaleString()} records imported</span>
        <span aria-hidden="true" style={{ color: T3, margin: '0 8px' }}>·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

function FleetDemoBanner() {
  return (
    <div style={{ background: TONE.warning.muted, border: `1px solid ${TONE.warning.border}`, borderRadius: 'var(--radius-lg)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ background: 'var(--bg-surface)', color: TONE.warning.fg, border: `1px solid ${TONE.warning.border}`, borderRadius: 'var(--radius-sm)', padding: '2px 9px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>Demo</span>
      <div style={{ fontSize: 13, color: T2, lineHeight: 1.5 }}>
        Sample data is shown below.{' '}
        <span style={{ color: T1, fontWeight: 600 }}>Upload an Excel file to activate this dashboard with your real fleet data.</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: T2 }}>
          Go to <span style={{ fontFamily:'var(--bb-font-mono)', color: T1 }}>Data → Upload</span> and select service type <span style={{ fontFamily:'var(--bb-font-mono)', color: T1 }}>Fleet</span>.
        </span>
      </div>
    </div>
  );
}

function ServicingTab({data}:{data:SvcRecord[]}) {
  const chart = useDashboardChart();
  if (!data.length) return <Empty/>;
  const totalCost=data.reduce((s,r)=>s+r.cost,0);
  const overdue=data.filter(r=>r.status==='Overdue').length;
  const dueSoon=data.filter(r=>r.status==='Due Soon').length;
  const next=[...data].sort((a,b)=>new Date(a.nextDue).getTime()-new Date(b.nextDue).getTime())[0];
  const costChart=data.map(r=>({id:r.asset,cost:r.cost}));
  const byType=Object.entries(data.reduce<Record<string,number>>((a,r)=>({...a,[r.serviceType]:(a[r.serviceType]||0)+r.cost}),{})).map(([name,value])=>({name,value}));
  const typeColors=[chart.palette.primary,chart.palette.warning,chart.palette.success];
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<DollarSign size={16}/>} label="Total Service Cost" value={fmt(totalCost)} accent="blue"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Overdue" value={String(overdue)} sub="Immediate attention" accent="red"/>
      <KPI2 icon={<Clock size={16}/>} label="Due Soon" value={String(dueSoon)} sub="Within 30 days" accent="amber"/>
      <KPI2 icon={<Wrench size={16}/>} label="Next Service" value={next?.asset??'—'} sub={next?.nextDue} accent="violet"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Service Cost by Asset</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={costChart} barSize={28}><XAxis dataKey="id" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/><Tooltip formatter={(v:unknown)=>fmt(Number(v))} {...chart.tooltip}/><Bar dataKey="cost" name="Service Cost" radius={[4,4,0,0]} fill={chart.palette.primary}/></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>By Service Type</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byType} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2} stroke={chart.palette.tooltipBg}>{byType.map((_,i)=><Cell key={i} fill={typeColors[i%3]}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmt(Number(v))} {...chart.tooltip}/></PieChart></ResponsiveContainer><div className="space-y-2 mt-2">{byType.map((d,i)=>(<div key={d.name} className="flex justify-between text-xs"><span style={{display:'flex',alignItems:'center',gap:8,color:T2}}><span aria-hidden="true" className="w-2 h-2 rounded-full" style={{background:typeColors[i%3]}}/>{d.name}</span><span className="font-semibold" style={{color:T1}}>{fmt(d.value)}</span></div>))}</div></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>Service Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Make','Service Type','Last Service','Next Due','Odometer','Cost','Notes','Status']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><TD>{r.make}</TD><TD>{r.serviceType}</TD><TD>{r.lastService}</TD><TD>{r.nextDue}</TD><TD>{r.odometer.toLocaleString()} km</TD><TD>{fmt(r.cost)}</TD><td style={{padding:'10px 16px',color:T3,fontSize:12}} className="max-w-xs truncate">{r.notes||'—'}</td><td className="px-5 py-3"><Badge label={r.status} tone={STATUS_C[r.status]||'inactive'}/></td></TR>))}</tbody></table>
    </div></>
  );
}

function HRTab({data}:{data:HRRecord[]}) {
  const chart = useDashboardChart();
  if (!data.length) return <Empty/>;
  const totalLabour=data.reduce((s,r)=>s+r.totalLabour,0);
  const totalWorked=data.reduce((s,r)=>s+r.workedHours,0);
  const totalOT=data.reduce((s,r)=>s+r.overtime,0);
  const totalAbsent=data.reduce((s,r)=>s+r.absentDays,0);
  const hoursChart=data.map(r=>({driver:r.driver.split(' ')[1]||r.driver,scheduled:r.scheduledHours,worked:r.workedHours,overtime:r.overtime}));
  const pie=[{name:'Regular',value:totalWorked-totalOT},{name:'Overtime',value:totalOT}];
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<DollarSign size={16}/>} label="Total Labour Cost" value={fmt(totalLabour)} accent="blue"/>
      <KPI2 icon={<Users size={16}/>} label="Total Hours Worked" value={fmtH(totalWorked)} accent="emerald"/>
      <KPI2 icon={<Clock size={16}/>} label="Total Overtime" value={fmtH(totalOT)} sub={`${((totalOT/totalWorked)*100).toFixed(1)}% of hours`} accent="amber"/>
      <KPI2 icon={<Activity size={16}/>} label="Absent Days" value={String(totalAbsent)} accent="red"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Scheduled vs Worked vs Overtime</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={hoursChart} barSize={18}><XAxis dataKey="driver" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><Tooltip {...chart.tooltip}/><Legend wrapperStyle={chart.legend}/><Bar dataKey="scheduled" name="Scheduled" fill={chart.palette.comparison} radius={[2,2,0,0]}/><Bar dataKey="worked" name="Worked" fill={chart.palette.primary} radius={[2,2,0,0]}/><Bar dataKey="overtime" name="Overtime" fill={chart.palette.warning} radius={[2,2,0,0]}/></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>Hours Split</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={pie} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2} stroke={chart.palette.tooltipBg}>{pie.map((_,i)=><Cell key={i} fill={[chart.palette.primary,chart.palette.warning][i]}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmtH(Number(v))} {...chart.tooltip}/></PieChart></ResponsiveContainer></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>HR Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Driver','Department','Sched. Hrs','Worked Hrs','Overtime','Absent Days','Hourly Rate','Total Labour']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><TD>{r.driver}</TD><TD>{r.department}</TD><TD>{r.scheduledHours}</TD><TD>{r.workedHours}</TD><td style={{padding:'10px 16px',color:r.overtime>0?TONE.warning.fg:T2,fontWeight:r.overtime>0?700:400,fontSize:13}}>{r.overtime}</td><td style={{padding:'10px 16px',color:r.absentDays>3?TONE.danger.fg:T2,fontWeight:r.absentDays>3?700:400,fontSize:13}}>{r.absentDays}</td><TD>{fmt(r.hourlyRate)}/hr</TD><TD bold>{fmt(r.totalLabour)}</TD></TR>))}</tbody></table>
    </div></>
  );
}

function DowntimeTab({data}:{data:DtRecord[]}) {
  const chart = useDashboardChart();
  if (!data.length) return <Empty/>;
  const totalHours=data.reduce((s,r)=>s+r.hours,0);
  const totalCost=data.reduce((s,r)=>s+r.cost,0);
  const open=data.filter(r=>!r.resolved).length;
  const byCat=Object.entries(data.reduce<Record<string,number>>((a,r)=>({...a,[r.category]:(a[r.category]||0)+r.hours}),{})).map(([name,value])=>({name,value}));
  const catColor=(name:string,i:number)=>CAT_C[name]?pc(chart,CAT_C[name]):chart.series[i%chart.series.length];
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<Clock size={16}/>} label="Total Downtime Hours" value={fmtH(totalHours)} accent="amber"/>
      <KPI2 icon={<DollarSign size={16}/>} label="Total Downtime Cost" value={fmt(totalCost)} accent="red"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Open Issues" value={String(open)} sub="Unresolved" accent="red"/>
      <KPI2 icon={<Shield size={16}/>} label="Resolved" value={String(data.length-open)} accent="emerald"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Downtime Hours by Category</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={byCat} barSize={40}><XAxis dataKey="name" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><Tooltip {...chart.tooltip}/><Bar dataKey="value" name="Hours" radius={[4,4,0,0]}>{byCat.map((d,i)=><Cell key={i} fill={catColor(d.name,i)}/>)}</Bar></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>Category Split</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byCat} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2} stroke={chart.palette.tooltipBg}>{byCat.map((d,i)=><Cell key={i} fill={catColor(d.name,i)}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmtH(Number(v))} {...chart.tooltip}/></PieChart></ResponsiveContainer></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>Downtime Log</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Date','Category','Reason','Hours','Cost','Status']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><TD>{r.date}</TD><td className="px-5 py-3"><Badge label={r.category} tone={CAT_TONE[r.category]||'inactive'}/></td><td style={{padding:'10px 16px',color:T2,fontSize:13,maxWidth:240}} className="truncate">{r.reason}</td><TD>{r.hours} hrs</TD><TD>{fmt(r.cost)}</TD><td className="px-5 py-3"><Badge label={r.resolved?'Resolved':'Open'} tone={r.resolved?'success':'danger'}/></td></TR>))}</tbody></table>
    </div></>
  );
}

function UtilisationTab({data}:{data:UtilRecord[]}) {
  const chart = useDashboardChart();
  if (!data.length) return <Empty/>;
  const avgUtil=(data.reduce((s,r)=>s+r.utilisationPct,0)/data.length).toFixed(1);
  const totalIdle=data.reduce((s,r)=>s+r.idleCost,0);
  const chartData=data.map(r=>({asset:r.asset,utilisation:r.utilisationPct,idle:100-r.utilisationPct}));
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<Gauge size={16}/>} label="Avg Utilisation" value={`${avgUtil}%`} accent="blue"/>
      <KPI2 icon={<DollarSign size={16}/>} label="Total Idle Cost" value={fmt(totalIdle)} accent="amber"/>
      <KPI2 icon={<Activity size={16}/>} label="Assets Tracked" value={String(data.length)} accent="emerald"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Below 70%" value={String(data.filter(r=>r.utilisationPct<70).length)} sub="Underutilised" accent="red"/>
    </div>
    <div style={DARK_CARD}><SecTitle>Utilisation vs Idle by Asset</SecTitle><ResponsiveContainer width="100%" height={260}><BarChart data={chartData} barSize={28}><XAxis dataKey="asset" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={(v:unknown)=>`${Number(v).toFixed(1)}%`} {...chart.tooltip}/><Legend wrapperStyle={chart.legend}/><Bar dataKey="utilisation" name="Utilised %" stackId="a" fill={chart.palette.success} radius={[0,0,0,0]}/><Bar dataKey="idle" name="Idle %" stackId="a" fill={chart.palette.neutral} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden',marginTop:16}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>Utilisation Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Type','Scheduled Hrs','Operating Hrs','Idle Hrs','Utilisation %','Idle Cost']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><TD>{r.type}</TD><TD>{r.scheduledHours}</TD><TD>{r.operatingHours}</TD><TD>{r.idleHours}</TD><td style={{padding:'10px 16px',fontWeight:700,color:r.utilisationPct<70?TONE.danger.fg:r.utilisationPct<80?TONE.warning.fg:TONE.success.fg,fontSize:13}}>{r.utilisationPct}%</td><TD>{fmt(r.idleCost)}</TD></TR>))}</tbody></table>
    </div></>
  );
}

function GeofenceTab({trips,stops,coloc}:{trips:TripRecord[];stops:StopRecord[];coloc:ColocRecord[]}) {
  const chart = useDashboardChart();
  const [assetFilter,setAssetFilter]=useState('All');
  const assets=['All',...Array.from(new Set([...trips.map(t=>t.asset),...stops.map(s=>s.asset)])).sort()];
  const filteredTrips=assetFilter==='All'?trips:trips.filter(t=>t.asset===assetFilter);
  const filteredStops=assetFilter==='All'?stops:stops.filter(s=>s.asset===assetFilter);
  const totalTrips=filteredTrips.length;
  const totalStops=filteredStops.length;
  const totalHours=filteredTrips.reduce((s,t)=>s+t.hoursOut,0);
  const colocEvents=coloc.length;
  const stopByType=Object.entries(filteredStops.reduce<Record<string,number>>((a,s)=>({...a,[s.stopType]:(a[s.stopType]||0)+1}),{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  if(!trips.length&&!stops.length) return <Empty/>;
  return(
    <><div className="grid grid-cols-4 gap-4 mb-6">
      <KPI2 icon={<Truck size={16}/>} label="Total Trips" value={String(totalTrips)} accent="blue"/>
      <KPI2 icon={<MapPin size={16}/>} label="Total Stops" value={String(totalStops)} accent="violet"/>
      <KPI2 icon={<Clock size={16}/>} label="Total Hours Out" value={fmtH(totalHours)} accent="emerald"/>
      <KPI2 icon={<Activity size={16}/>} label="Co-location Events" value={String(colocEvents)} accent="amber"/>
    </div>
    <div role="group" aria-label="Filter by asset" style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      {assets.map(a=>(<button key={a} type="button" aria-pressed={assetFilter===a} onClick={()=>setAssetFilter(a)} style={{padding:'4px 12px',borderRadius:'var(--radius-md)',fontSize:12,fontWeight:600,cursor:'pointer',border:assetFilter===a?'1px solid var(--brand-brainbase-accent-border)':'1px solid var(--border-strong)',background:assetFilter===a?'var(--brand-brainbase-accent-muted)':'var(--bg-surface)',color:assetFilter===a?T1:T2}}>{a}</button>))}
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Stops by Type</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={stopByType} layout="vertical" barSize={14} margin={{left:120}}><XAxis type="number" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} width={120}/><Tooltip {...chart.tooltip}/><Bar dataKey="value" name="Stops" radius={[0,6,6,0]}>{stopByType.map((_,i)=><Cell key={i} fill={pc(chart,STOP_C[_.name])}/>)}</Bar></BarChart></ResponsiveContainer></div>
      {coloc.length>0&&(<div style={DARK_CARD}><SecTitle>Co-location Events</SecTitle><div className="space-y-3">{coloc.slice(0,5).map((c,i)=>(<div key={i} style={{borderBottom:'1px solid var(--border)',paddingBottom:10}}><div style={{fontSize:12,fontWeight:600,color:T1,marginBottom:2}}>{c.area}</div><div style={{fontSize:11,color:T2}}>{c.vehicles}</div><div style={{fontSize:11,color:T3,marginTop:2}}>{c.date} · {c.durationMins} min</div></div>))}</div></div>)}
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden',marginBottom:20}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>Daily Trip Log</SecTitle></div><div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><THead cols={['Asset','Driver','Date','Yard Dep.','Yard Ret.','Hours Out','Stops','Areas Visited']}/><tbody>{filteredTrips.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><td style={{padding:'10px 16px',color:T2}}>{r.driver}</td><TD>{r.date}</TD><td style={{padding:'10px 16px',fontWeight:500,color:TONE.success.fg}}>{r.yardDep}</td><td style={{padding:'10px 16px',fontWeight:500,color:TONE.info.fg}}>{r.yardRet}</td><TD>{r.hoursOut} hrs</TD><td style={{padding:'10px 16px',textAlign:'center',color:T2}}>{r.stopsMade}</td><td style={{padding:'10px 16px',fontSize:12,color:T3}}>{r.areasVisited}</td></TR>))}</tbody></table></div></div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}><SecTitle>Stop Event Log</SecTitle></div><div className="overflow-x-auto max-h-96 overflow-y-auto"><table className="w-full text-sm whitespace-nowrap"><THead cols={['Asset','Driver','Date','Area / Location','Arrival','Departure','Duration','Stop Type']}/><tbody>{filteredStops.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'8px 16px',fontWeight:600,color:T1,fontFamily:'var(--bb-font-mono)'}}>{r.asset}</td><td style={{padding:'8px 16px',color:T2}}>{r.driver}</td><TD>{r.date}</TD><TD>{r.area}</TD><td style={{padding:'8px 16px',color:T2}}>{r.arrival}</td><td style={{padding:'8px 16px',color:T2}}>{r.departure}</td><td style={{padding:'8px 16px',fontWeight:500,color:T2}}>{r.durationMins} min</td><td className="px-5 py-2.5"><DotChip label={r.stopType} color={pc(chart,STOP_C[r.stopType])}/></td></TR>))}</tbody></table></div></div></>
  );
}

// ─── Lifecycle & Replacement sample data ──────────────────────────────────────

const LIFECYCLE_SAMPLE = [
  { id:'TRK-001', type:'Heavy Truck', year:2018, purchaseCost:185000, fuel:28400, maintenance:14200, insurance:6800, rego:4200, depreciation:22000, totalOwnership:260600, km:98400, costPerKm:2.65, replacementYear:2028 },
  { id:'TRK-002', type:'Heavy Truck', year:2016, purchaseCost:172000, fuel:31200, maintenance:18600, insurance:6200, rego:4100, depreciation:18000, totalOwnership:250100, km:142800, costPerKm:1.75, replacementYear:2026 },
  { id:'LV-041',  type:'Light Vehicle', year:2021, purchaseCost:42000, fuel:8400, maintenance:3200, insurance:2800, rego:1200, depreciation:6800, totalOwnership:64400, km:44200, costPerKm:1.46, replacementYear:2031 },
  { id:'EXC-007', type:'Excavator', year:2019, purchaseCost:420000, fuel:44200, maintenance:28400, insurance:12400, rego:0, depreciation:52000, totalOwnership:557000, km:0, costPerKm:0, replacementYear:2029 },
  { id:'TRK-008', type:'Heavy Truck', year:2020, purchaseCost:198000, fuel:26800, maintenance:11200, insurance:7200, rego:4400, depreciation:28000, totalOwnership:275600, km:68200, costPerKm:4.04, replacementYear:2030 },
];

const MONTHLY_TREND: MonthlyPoint[] = [
  { month: 'Jul', actual: 142000, budget: 148000 }, { month: 'Aug', actual: 156000, budget: 148000 },
  { month: 'Sep', actual: 138000, budget: 145000 }, { month: 'Oct', actual: 168000, budget: 152000 },
  { month: 'Nov', actual: 144000, budget: 148000 }, { month: 'Dec', actual: 152000, budget: 155000 },
  { month: 'Jan', actual: 131000, budget: 140000 }, { month: 'Feb', actual: 139000, budget: 140000 },
  { month: 'Mar', actual: 162000, budget: 150000 }, { month: 'Apr', actual: 148000, budget: 150000 },
];

const COST_ACCOUNTS: CostAccount[] = [
  { account: 'Wages & Labour', dept: 'Operations',  budget: 380000, actual: 412000 },
  { account: 'Fuel',           dept: 'Fleet',        budget: 280000, actual: 308000 },
  { account: 'Maintenance',    dept: 'Workshop',     budget: 140000, actual: 158000 },
  { account: 'Repairs',        dept: 'Workshop',     budget: 80000,  actual: 92000 },
  { account: 'Insurance',      dept: 'Finance',      budget: 68000,  actual: 67200 },
  { account: 'Rego & Licensing',dept:'Finance',      budget: 42000,  actual: 41800 },
  { account: 'Depreciation',   dept: 'Finance',      budget: 220000, actual: 220000 },
];

const SLA_TARGETS: SLATarget[] = [
  { kpi: 'Fleet availability rate', target: '≥ 92%', actual: '88.4%', status: 'At Risk', note: 'TRK-002 extended downtime' },
  { kpi: 'Scheduled service compliance', target: '100%', actual: '94%', status: 'Missed', note: '3 assets overdue' },
  { kpi: 'Avg cost per km', target: '< $2.50', actual: '$2.74', status: 'Missed', note: 'TRK-008 distorts avg' },
  { kpi: 'Fleet defect resolution', target: '< 48h', actual: '36h', status: 'Met' },
  { kpi: 'Utilisation rate', target: '≥ 75%', actual: '72.8%', status: 'At Risk', note: 'Idle assets — review need' },
  { kpi: 'Overtime as % of hours', target: '< 8%', actual: '6.2%', status: 'Met' },
];

const DEFAULT_ACTIONS: Action[] = [
  { id: '1', title: 'Schedule TRK-002 for major service — overdue', assignee: 'Workshop Manager', dueDate: '2026-05-10', status: 'Not started', priority: 'High' },
  { id: '2', title: 'Review replacement plan for TRK-002 (8 years old, high cost)', assignee: 'Fleet Manager', dueDate: '2026-05-31', status: 'In progress', priority: 'High' },
  { id: '3', title: 'Reduce TRK-008 idle time — reassign route', assignee: 'Operations', dueDate: '2026-06-01', status: 'Not started', priority: 'Medium' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FleetClient({ dbAssets = [], uploadMeta = null, isDemo = false }: { dbAssets?: Asset[]; uploadMeta?: FleetUploadMeta | null; isDemo?: boolean }) {
  const router = useRouter();
  const chart = useDashboardChart();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [svc,     setSvc]     = useState<SvcRecord[]>([]);
  const [hr,      setHr]      = useState<HRRecord[]>([]);
  const [dt,      setDt]      = useState<DtRecord[]>([]);
  const [util,    setUtil]    = useState<UtilRecord[]>([]);
  const [trips,   setTrips]   = useState<TripRecord[]>([]);
  const [stops,   setStops]   = useState<StopRecord[]>([]);
  const [coloc,   setColoc]   = useState<ColocRecord[]>([]);
  const [search,  setSearch]  = useState('');
  const [dept,    setDept]    = useState('All');

  // Initial load: DB data takes priority, then localStorage, then bundled dummy
  useEffect(() => {
    if (dbAssets.length > 0) {
      setAssets(dbAssets);
      return;
    }
    const saved = localStorage.getItem('fleetAll');
    if (saved) {
      const d = JSON.parse(saved);
      setAssets(d.assets||[]); setSvc(d.svc||[]); setHr(d.hr||[]); setDt(d.dt||[]);
      setUtil(d.util||[]); setTrips(d.trips||[]); setStops(d.stops||[]); setColoc(d.coloc||[]);
      return;
    }
    fetch('/fleet-dummy-data.xlsx')
      .then(r => r.arrayBuffer())
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = (name: string) => { const s = wb.Sheets[name]; return s ? R(XLSX.utils.sheet_to_json(s) as Record<string,unknown>[]) : []; };
        const d = { assets:parseAssets(sheet('Fleet Data')), svc:parseSvc(sheet('Servicing')), hr:parseHR(sheet('HR')), dt:parseDt(sheet('Downtime')), util:parseUtil(sheet('Utilisation')), trips:parseTrips(sheet('Trip Log')), stops:parseStops(sheet('Stop Log')), coloc:parseColoc(sheet('Co-location')) };
        setAssets(d.assets); setSvc(d.svc); setHr(d.hr); setDt(d.dt); setUtil(d.util); setTrips(d.trips); setStops(d.stops); setColoc(d.coloc);
        localStorage.setItem('fleetAll', JSON.stringify(d));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync fresh DB data after router.refresh()
  useEffect(() => {
    if (dbAssets.length > 0) setAssets(dbAssets);
  }, [dbAssets]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target!.result, { type: 'binary' });
      const sheet = (name: string) => { const s = wb.Sheets[name]; return s ? R(XLSX.utils.sheet_to_json(s) as Record<string,unknown>[]) : []; };
      const d = { assets:parseAssets(sheet('Fleet Data')), svc:parseSvc(sheet('Servicing')), hr:parseHR(sheet('HR')), dt:parseDt(sheet('Downtime')), util:parseUtil(sheet('Utilisation')), trips:parseTrips(sheet('Trip Log')), stops:parseStops(sheet('Stop Log')), coloc:parseColoc(sheet('Co-location')) };
      setAssets(d.assets); setSvc(d.svc); setHr(d.hr); setDt(d.dt); setUtil(d.util); setTrips(d.trips); setStops(d.stops); setColoc(d.coloc);
      localStorage.setItem('fleetAll', JSON.stringify(d));
      // Persist fleet metrics to DB
      const form = new FormData();
      form.append('file', file);
      form.append('serviceType', 'fleet');
      try {
        await fetch('/api/upload', { method: 'POST', body: form });
        router.refresh();
      } catch { /* local data already set above */ }
    };
    reader.readAsBinaryString(file);
  };

  const depts = ['All', ...Array.from(new Set(assets.map(a => a.department))).sort()];
  const view = assets.filter(a => dept === 'All' || a.department === dept).filter(a => a.id.toLowerCase().includes(search.toLowerCase()) || a.driver.toLowerCase().includes(search.toLowerCase()));
  const total = view.reduce((s, a) => s + a.total, 0);
  const totalKm = view.reduce((s, a) => s + a.km, 0);
  const totalDepr = view.reduce((s, a) => s + a.depreciation, 0);
  const totalDefects = view.reduce((s, a) => s + a.defects, 0);
  const avgCpk = totalKm > 0 ? total / totalKm : 0;
  const highest = view.length ? [...view].sort((a,b)=>b.total-a.total)[0] : null;
  const worstEff = view.length ? [...view].sort((a,b)=>b.costPerKm-a.costPerKm)[0] : null;
  const pieData = (['wages','fuel','maintenance','rego','repairs','insurance'] as const).map(k=>({name:k[0].toUpperCase()+k.slice(1),key:k,value:view.reduce((s,a)=>s+a[k],0)})).filter(d=>d.value>0);
  const topCat = [...pieData].sort((a,b)=>b.value-a.value)[0];
  const deptData = Array.from(new Set(assets.map(a=>a.department))).map(d=>({name:d,cost:assets.filter(a=>a.department===d).reduce((s,a)=>s+a.total,0),assets:assets.filter(a=>a.department===d).length})).sort((a,b)=>b.cost-a.cost);
  const effData = view.map(a=>({id:a.id,cpk:+a.costPerKm.toFixed(2)}));

  const kpis: KPI[] = assets.length ? [
    { label: 'Total Fleet Cost',   value: fmt(total),               sub: `${view.length} assets`,    icon: '💰', status: 'normal' },
    { label: 'Total KM Driven',    value: fmtK(totalKm),            sub: 'This period',              icon: '🗺', status: 'normal' },
    { label: 'Avg Cost / KM',      value: `$${avgCpk.toFixed(2)}`,  sub: 'Fleet average',            icon: '📊', alert: avgCpk > 2.5, status: avgCpk > 2.5 ? 'risk' : avgCpk > 2.0 ? 'watch' : 'normal' },
    { label: 'Fleet Defects',      value: String(totalDefects),     sub: 'Open items',               icon: '🔧', alert: totalDefects > 5, status: totalDefects > 5 ? 'risk' : totalDefects > 2 ? 'watch' : 'normal' },
    { label: 'Total Depreciation', value: fmt(totalDepr),           sub: 'This period',              icon: '📉', status: 'normal' },
  ] : [];

  const card: React.CSSProperties = { background:'var(--bg-surface)', borderRadius:'var(--radius-lg)', border:'1px solid var(--border)', padding:24 };
  const cardTitle: React.CSSProperties = { fontSize:11, fontWeight:600, color:T2, textTransform:'uppercase', letterSpacing:'0.06em', margin:0 };
  const cardSub: React.CSSProperties = { fontSize:11, color:T3, margin:'3px 0 0' };
  const costColor = (key: string) => pc(chart, C[key]);
  const cpkTone = (cpk: number): Tone | null => cpk>avgCpk*1.1 ? 'danger' : cpk>avgCpk ? 'warning' : 'success';
  const tdc: React.CSSProperties = { padding:'10px 14px', color:T2 };
  const tfc: React.CSSProperties = { padding:'10px 14px', color:T1, fontSize:11, fontVariantNumeric:'tabular-nums' };

  const overviewContent = assets.length === 0 ? (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 0', textAlign:'center' }}>
      <div aria-hidden="true" style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)', padding:20, borderRadius:'var(--radius-lg)', marginBottom:16, color:T3 }}><Truck size={32}/></div>
      <h2 style={{ fontSize:18, fontWeight:700, color:T1, marginBottom:8 }}>No Fleet Data Loaded</h2>
      <p style={{ fontSize:13, color:T2, marginBottom:20 }}>Upload your multi-sheet Excel file to activate live analytics.</p>
      <button type="button" onClick={() => uploadRef.current?.click()} {...buttonProps('primary')}>
        <Upload size={14} aria-hidden="true"/> Upload Fleet Data
      </button>
      <input ref={uploadRef} type="file" hidden accept=".xlsx,.xls" onChange={handleUpload} aria-label="Upload fleet data file"/>
    </div>
  ) : (
    <>
      {!isDemo && uploadMeta && <FleetDataBanner meta={uploadMeta} />}
      {isDemo && <FleetDemoBanner />}
      {!isDemo && <HlnaInsightBanner dashboardType="fleet" />}
      <div role="group" aria-label="Filter by department" style={{ display:'flex', gap:6, marginBottom:20, flexWrap:'wrap' }}>
        {depts.map(d => (
          <button key={d} type="button" aria-pressed={dept===d} onClick={() => setDept(d)} style={{
            padding:'5px 14px', borderRadius:'var(--radius-md)', fontSize:12, fontWeight:600, cursor:'pointer',
            border: dept===d ? '1px solid var(--brand-brainbase-accent-border)' : '1px solid var(--border-strong)',
            background: dept===d ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-surface)',
            color: dept===d ? T1 : T2,
            transition:'background-color 0.12s ease, border-color 0.12s ease',
          }}>{d}</button>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
            <div>
              <p style={cardTitle}>Operational Cost by Asset</p>
              <p style={cardSub}>{dept==='All'?'All departments':dept} · stacked by category</p>
            </div>
            <span style={{ fontSize:13, fontWeight:700, color:T1, fontVariantNumeric:'tabular-nums' }}>{fmt(total)}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={view} barSize={26} margin={{left:10,right:10}}>
              <XAxis dataKey="id" tick={chart.tick} axisLine={false} tickLine={false}/>
              <YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} {...chart.tooltip}/>
              <Legend wrapperStyle={{...chart.legend,paddingTop:14}}/>
              <Bar dataKey="wages"       stackId="a" fill={costColor('wages')} name="Wages"/>
              <Bar dataKey="fuel"        stackId="a" fill={costColor('fuel')} name="Fuel"/>
              <Bar dataKey="maintenance" stackId="a" fill={costColor('maintenance')} name="Maintenance"/>
              <Bar dataKey="repairs"     stackId="a" fill={costColor('repairs')} name="Repairs"/>
              <Bar dataKey="insurance"   stackId="a" fill={costColor('insurance')} name="Insurance"/>
              <Bar dataKey="rego"        stackId="a" fill={costColor('rego')} name="Rego" radius={[5,5,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{...card, display:'flex', flexDirection:'column'}}>
          <p style={{ ...cardTitle, margin:'0 0 4px' }}>Cost Category Split</p>
          <div style={{ position:'relative' }}>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={56} outerRadius={84} dataKey="value" paddingAngle={3} stroke={chart.palette.tooltipBg}>
                  {pieData.map(d=><Cell key={d.key} fill={costColor(d.key)}/>)}
                </Pie>
                <Tooltip formatter={(v:unknown)=>fmt(Number(v))} {...chart.tooltip}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center', pointerEvents:'none' }}>
              <div style={{ fontSize:13, fontWeight:700, color:T1, lineHeight:1.1 }}>{fmt(total)}</div>
              <div style={{ fontSize:10, color:T3, fontWeight:600, letterSpacing:'0.06em' }}>TOTAL</div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:'auto' }}>
            {[...pieData].sort((a,b)=>b.value-a.value).map(d=>(
              <div key={d.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11 }}>
                <span style={{ display:'flex', alignItems:'center', gap:7, color:T2 }}>
                  <span aria-hidden="true" style={{ width:8, height:8, borderRadius:'50%', background:costColor(d.key), flexShrink:0 }}/>
                  {d.name}
                </span>
                <div style={{ textAlign:'right' }}>
                  <span style={{ fontWeight:700, color:T1 }}>{((d.value/total)*100).toFixed(1)}%</span>
                  <span style={{ fontSize:11, color:T3, marginLeft:6 }}>{fmt(d.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        <div style={card}>
          <p style={{ ...cardTitle, margin:'0 0 14px' }}>Cost by Department</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={deptData} layout="vertical" barSize={14} margin={{left:100,right:20}}>
              <XAxis type="number" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="name" tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} width={100}/>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} {...chart.tooltip}/>
              <Bar dataKey="cost" name="Cost" radius={[0,6,6,0]}>
                {deptData.map((d,i)=><Cell key={i} fill={pc(chart,DEPT_C[d.name])}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <p style={cardTitle}>Assets to Watch</p>
            <Badge label={`${effData.filter(d=>d.cpk>avgCpk*1.1).length} over threshold`} tone="danger"/>
          </div>
          {[...view].sort((a,b)=>b.costPerKm-a.costPerKm).slice(0,5).map((a,i)=>{
            const tone = cpkTone(a.costPerKm) ?? 'success';
            return (
            <div key={a.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom: i<4?'1px solid var(--border)':'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div aria-hidden="true" style={{ width:34, height:34, borderRadius:'var(--radius-md)', background:TONE[tone].muted, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                  {a.costPerKm>avgCpk*1.1?'⚠️':a.costPerKm>avgCpk?'⏱':'✅'}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:T1 }}><span style={{ fontFamily:'var(--bb-font-mono)' }}>{a.id}</span> <span style={{ fontSize:11, color:T3, fontWeight:400 }}>{a.make}</span></div>
                  <div style={{ fontSize:11, color:T3 }}>{a.department} · {a.year}</div>
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:13, fontWeight:700, color:TONE[tone].fg, fontVariantNumeric:'tabular-nums' }}>${a.costPerKm.toFixed(2)}/km</div>
                <div style={{ fontSize:11, color:T3 }}>fleet avg ${avgCpk.toFixed(2)}</div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <div style={{...card, marginBottom:16}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <p style={cardTitle}>Cost per KM by Asset</p>
            <p style={cardSub}>Dashed line = fleet average ${avgCpk.toFixed(2)}/km</p>
          </div>
          <Badge label={`${effData.filter(d=>d.cpk>avgCpk*1.1).length} assets above threshold`} tone="warning"/>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={effData} barSize={28} margin={{left:10,right:10}}>
            <XAxis dataKey="id" tick={chart.tick} axisLine={false} tickLine={false}/>
            <YAxis tick={{...chart.tick,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <Tooltip formatter={(v:unknown)=>[`$${Number(v).toFixed(2)}/km`,'Cost per KM']} {...chart.tooltip}/>
            <ReferenceLine y={+avgCpk.toFixed(2)} stroke={chart.palette.axis} strokeDasharray="5 4" label={{ value:'avg', fill:chart.palette.axis, fontSize:10 }}/>
            <Bar dataKey="cpk" name="$/km" radius={[6,6,0,0]}>
              {effData.map((d,i)=><Cell key={i} fill={d.cpk>avgCpk*1.1?chart.palette.danger:d.cpk<avgCpk*0.9?chart.palette.success:chart.palette.primary}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background:'var(--bg-sunken)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'20px 28px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:24, flexWrap:'wrap' }}>
        <div>
          <p style={{ fontSize:11, color:T3, textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600, margin:'0 0 6px' }}>Fleet Summary · FY2025-26</p>
          <p style={{ fontSize:13, color:T2, lineHeight:1.6, margin:0, maxWidth:800 }}>
            <strong style={{color:T1}}>{view.length} assets</strong> · total cost <strong style={{color:T1}}>{fmt(total)}</strong> across <strong style={{color:T1}}>{fmtK(totalKm)}</strong> at <strong style={{color:avgCpk>2.5?TONE.danger.fg:T1}}>${avgCpk.toFixed(2)}/km</strong>.
            {highest && <> Highest cost: <strong style={{color:TONE.danger.fg}}>{highest.id}</strong> at {fmt(highest.total)}.</>}
            {topCat && <> <strong style={{color:T1}}>{topCat.name}</strong> drives {((topCat.value/total)*100).toFixed(1)}% of spend.</>}
          </p>
        </div>
        <div style={{ display:'flex', gap:20, flexShrink:0 }}>
          {[{label:'Defects',value:String(totalDefects),alert:totalDefects>2},{label:'Over Budget',value:effData.filter(d=>d.cpk>avgCpk*1.1).length+' assets',alert:true}].map(m=>(
            <div key={m.label} style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:700, color:m.alert?TONE.danger.fg:T1, fontVariantNumeric:'tabular-nums' }}>{m.value}</div>
              <div style={{ fontSize:11, color:T3, textTransform:'uppercase', letterSpacing:'0.06em' }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{...card, padding:0, overflow:'hidden'}}>
        <div style={{ padding:'16px 24px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div>
            <p style={cardTitle}>Asset Register</p>
            <p style={{ ...cardSub, margin:'2px 0 0' }}>{view.length} assets · {dept==='All'?'all departments':dept}</p>
          </div>
          <input
            aria-label="Search asset or driver"
            style={{ fontSize:12, border:'1px solid var(--border-strong)', borderRadius:'var(--radius-md)', padding:'7px 12px', color:T1, background:'var(--bg-raised)', width:220 }}
            placeholder="Search asset or driver…"
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, whiteSpace:'nowrap' }}>
            <thead>
              <tr style={{ background:'var(--bg-sunken)', borderBottom:'1px solid var(--border)' }}>
                {['Asset','Type','Make','Yr','Department','Driver','KM','Wages','Fuel','Maint.','Repairs','Insur.','Rego','Svcs','Defects','$/km','Total'].map(h=>(
                  <th key={h} scope="col" style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:T2, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map(a=>(
                <tr key={a.id} style={{ borderBottom:'1px solid var(--border)' }}>
                  <td style={{ padding:'10px 14px', fontWeight:700, color:T1, fontFamily:'var(--bb-font-mono)' }}>{a.id}</td>
                  <td style={tdc}>{a.type}</td>
                  <td style={tdc}>{a.make}</td>
                  <td style={tdc}>{a.year}</td>
                  <td style={{ padding:'10px 14px' }}><DotChip label={a.department} color={pc(chart,DEPT_C[a.department])}/></td>
                  <td style={{ padding:'10px 14px', color:T1 }}>{a.driver}</td>
                  <td style={tdc}>{a.km.toLocaleString()}</td>
                  <td style={tdc}>{fmt(a.wages)}</td>
                  <td style={tdc}>{fmt(a.fuel)}</td>
                  <td style={tdc}>{fmt(a.maintenance)}</td>
                  <td style={tdc}>{fmt(a.repairs)}</td>
                  <td style={tdc}>{fmt(a.insurance)}</td>
                  <td style={tdc}>{fmt(a.rego)}</td>
                  <td style={{ ...tdc, textAlign:'center' }}>{a.services}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:a.defects>2?TONE.danger.fg:a.defects>0?TONE.warning.fg:TONE.success.fg }}>{a.defects}</td>
                  <td style={{ padding:'10px 14px', fontWeight:700, color:a.costPerKm>avgCpk*1.1?TONE.danger.fg:a.costPerKm<avgCpk*0.9?TONE.success.fg:T2 }}>${a.costPerKm.toFixed(2)}</td>
                  <td style={{ padding:'10px 14px', fontWeight:700, color:T1 }}>{fmt(a.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background:'var(--bg-sunken)', borderTop:'2px solid var(--border-strong)' }}>
                <td style={{ padding:'10px 14px', fontWeight:700, fontSize:11, textTransform:'uppercase', color:T2, letterSpacing:'0.06em' }} colSpan={6}>Total</td>
                <td style={tfc}>{totalKm.toLocaleString()} km</td>
                {COST_KEYS.map(k=>(
                  <td key={k} style={tfc}>{fmt(view.reduce((s,a)=>s+a[k],0))}</td>
                ))}
                <td style={tfc}>{view.reduce((s,a)=>s+a.services,0)}</td>
                <td style={tfc}>{totalDefects}</td>
                <td style={tfc}>${avgCpk.toFixed(2)}</td>
                <td style={{ ...tfc, fontWeight:700, fontSize:12 }}>{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );

  const lcTh: React.CSSProperties = { padding: '11px 14px', textAlign: 'left', fontSize: 11, color: T2, fontWeight: 600 };
  const lcTd: React.CSSProperties = { padding: '11px 14px', color: T1 };
  const cpkColor = (v: number) => v > 2.5 ? TONE.danger.fg : v > 0 ? TONE.success.fg : T3;
  const tcoColors = [chart.palette.secondary, chart.palette.primary, chart.palette.warning, chart.palette.success, chart.palette.neutral];

  const industryTabs = [
    { label: 'Servicing', content: <ServicingTab data={svc}/> },
    { label: 'HR & Labour', content: <HRTab data={hr}/> },
    { label: 'Downtime', content: <DowntimeTab data={dt}/> },
    { label: 'Plant Utilisation', content: <UtilisationTab data={util}/> },
    { label: 'Geofence', content: <GeofenceTab trips={trips} stops={stops} coloc={coloc}/> },
    {
      label: 'Lifecycle Cost',
      content: (
        <div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>{['Asset','Type','Year','Purchase Cost','Fuel (YTD)','Maintenance','Insurance','Rego','Depreciation','Total TCO','$/km','Replacement'].map(h=><th key={h} scope="col" style={lcTh}>{h}</th>)}</tr></thead>
              <tbody>{LIFECYCLE_SAMPLE.map(a=>(
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...lcTd, fontWeight: 700, fontFamily:'var(--bb-font-mono)' }}>{a.id}</td>
                  <td style={{ ...lcTd, color: T2 }}>{a.type}</td>
                  <td style={lcTd}>{a.year}</td>
                  <td style={lcTd}>${a.purchaseCost.toLocaleString()}</td>
                  <td style={lcTd}>${a.fuel.toLocaleString()}</td>
                  <td style={lcTd}>${a.maintenance.toLocaleString()}</td>
                  <td style={lcTd}>${a.insurance.toLocaleString()}</td>
                  <td style={lcTd}>{a.rego?`$${a.rego.toLocaleString()}`:'—'}</td>
                  <td style={{ ...lcTd, color: TONE.warning.fg }}>${a.depreciation.toLocaleString()}</td>
                  <td style={{ ...lcTd, fontWeight: 700 }}>${a.totalOwnership.toLocaleString()}</td>
                  <td style={{ ...lcTd, color: cpkColor(a.costPerKm) }}>{a.costPerKm > 0 ? `$${a.costPerKm}` : '—'}</td>
                  <td style={{ ...lcTd, color: a.replacementYear <= 2027 ? TONE.danger.fg : T1, fontWeight: a.replacementYear <= 2027 ? 700 : 400 }}>{a.replacementYear}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: T1 }}>TCO by Asset</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={LIFECYCLE_SAMPLE}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="id" tick={chart.tick} />
                  <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={chart.tick} />
                  <Tooltip formatter={(v:unknown)=>`$${Number(v).toLocaleString()}`} {...chart.tooltip} />
                  <Bar dataKey="totalOwnership" fill={chart.palette.primary} name="Total TCO" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: T1 }}>Cost Composition (TCO Split)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[{ name: 'Purchase', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.purchaseCost,0) }, { name: 'Fuel', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.fuel,0) }, { name: 'Maintenance', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.maintenance,0) }, { name: 'Insurance', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.insurance,0) }, { name: 'Depreciation', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.depreciation,0) }]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name} stroke={chart.palette.tooltipBg}>
                    {[...Array(5)].map((_, i) => <Cell key={i} fill={tcoColors[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v:unknown)=>`$${Number(v).toLocaleString()}`} {...chart.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ),
    },
    {
      label: 'Replacement Planning',
      content: (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 20 }}>
            {([['Due for Replacement', '2', 'Within 2 years', 'danger'], ['High-Cost Assets', '2', 'Above $2.50/km', 'warning'], ['Assets > 8 years', '1', 'TRK-002 (2016)', 'warning'], ['EOFY Budget Required', '$523k', 'For 2 replacements', 'info']] as [string, string, string, Tone][]).map(([l, v, s, c]) => (
              <div key={l} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: `2px solid ${TONE[c].fg}`, borderRadius: 'var(--radius-lg)', padding: 16 }}>
                <div style={{ fontSize: 11, color: T3, marginBottom: 6 }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: TONE[c].fg, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                <div style={{ fontSize: 11, color: T3, marginTop: 3 }}>{s}</div>
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--bg-sunken)' }}>{['Asset','Type','Year','Age (yrs)','TCO','$/km','Maint Cost','Replacement Year','Priority','Recommendation'].map(h=><th key={h} scope="col" style={lcTh}>{h}</th>)}</tr></thead>
              <tbody>{LIFECYCLE_SAMPLE.map(a => {
                const age = 2026 - a.year;
                const priority = a.replacementYear <= 2027 ? 'Urgent' : a.replacementYear <= 2029 ? 'Planned' : 'Monitor';
                const rec = a.costPerKm > 3 ? 'Replace — high $/km' : age > 7 ? 'Replace — age + maintenance risk' : age > 5 ? 'Monitor — approaching end of life' : 'Keep — within useful life';
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...lcTd, fontWeight: 700, fontFamily:'var(--bb-font-mono)' }}>{a.id}</td>
                    <td style={{ ...lcTd, color: T2 }}>{a.type}</td>
                    <td style={lcTd}>{a.year}</td>
                    <td style={{ ...lcTd, color: age > 7 ? TONE.danger.fg : T1, fontWeight: age > 7 ? 700 : 400 }}>{age}</td>
                    <td style={{ ...lcTd, fontWeight: 600 }}>${a.totalOwnership.toLocaleString()}</td>
                    <td style={{ ...lcTd, color: cpkColor(a.costPerKm) }}>{a.costPerKm > 0 ? `$${a.costPerKm}` : '—'}</td>
                    <td style={lcTd}>${a.maintenance.toLocaleString()}</td>
                    <td style={lcTd}>{a.replacementYear}</td>
                    <td style={lcTd}><Badge label={priority} tone={priority === 'Urgent' ? 'danger' : priority === 'Planned' ? 'warning' : 'success'}/></td>
                    <td style={{ ...lcTd, fontSize: 12, color: rec.includes('Replace') ? TONE.danger.fg : T2 }}>{rec}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
  ];

  return (
    <DashboardShell
      title="Fleet Management"
      subtitle="Asset lifecycle costing · Fuel & utilisation · Maintenance · HR & labour · Geofence"
      headerColor="#0c4a6e"
      accentColor="#c2410c"
      breadcrumbLabel="Fleet Management"
      kpis={kpis}
      recommendedActions={[
        {title:"Replace high cost-per-km assets (save $45k–$80k annually)",explanation:"Top 3 vehicles exceed fleet average cost/km by more than 40%. Held past optimal disposal point due to capital budget cap — not operational cost data.",impact:"$45,000–$80,000 annual savings on replacement assets",priority:"High"},
        {title:"Clear overdue service backlog before $28k in breakdown costs land",explanation:"Multiple assets past next-service due date. Deferred maintenance increases breakdown risk, invalidates warranty, and raises insurance exposure.",impact:"Prevent est. $28,000 in breakdown repair costs",priority:"High"},
        {title:"Reduce idle time on underutilised assets (save $18k–$35k annually)",explanation:"Vehicles averaging 28% idle time accumulate $18 per idle hour in fuel and engine wear. No telematics idle-reduction policy currently enforced.",impact:"$18,000–$35,000 annual idle cost reduction",priority:"Medium"},
        {title:"Optimise high-consumption routes (save $12k–$18k in annual fuel cost)",explanation:"Fuel is the largest operating cost driver. GPS-based route coaching and driver profiling can reduce consumption by 8–12% without adding resources.",impact:"Est. $12,000–$18,000 annual fuel saving",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"4 vehicles above $180K total ownership cost — held 2+ years past optimal disposal point",cause:"Replacement decisions driven by capital budget cap, not operational cost data — asset cost analysis not reviewed this FY",recommendation:"Approve disposal of the 2 highest-cost assets this quarter; net replacement benefit $45k–$80k annually",severity:"High"},
        {problem:"Fleet idle time averaging 28% — costing est. $94k annually at $18 per idle hour",cause:"No telematics-based idle reduction policy in place; drivers unaware of the financial cost of engine idling",recommendation:"Deploy idle alert thresholds in telematics; target 10% idle rate — projected saving $18k–$35k annually",severity:"Medium"},
        {problem:"6 assets past scheduled service date — WHS liability and insurance exposure rising daily",cause:"Workshop at capacity with 3 mechanics short; service backlog growing faster than throughput allows",recommendation:"Outsource overflow maintenance immediately; clear full backlog within 30 days to restore compliance",severity:"Medium"},
      ]}
      overviewContent={overviewContent}
      industryTabs={industryTabs}
      sampleData={{ 'Fleet Data': LIFECYCLE_SAMPLE }}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="This is a fleet management dashboard for local government. Key concerns are TRK-002 age and service overdue, TRK-008 high cost per km, and overall fleet availability."
      executiveSummary="Fleet operating costs are trending above budget with 4 assets past disposal threshold and 6 overdue service schedules — $45k–$80k in savings identified from replacement and idle reduction."
      snapshotPanel={{ topCostDriver: 'Fuel & maintenance on TRK-002 / TRK-008', biggestRisk: 'Overdue service schedules creating WHS liability across 6 assets', savingsIdentified: 103000, confidence: 87, lastUpdated: 'Apr 2026' }}
    />
  );
}
