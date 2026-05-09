'use client';
import { useState } from 'react';
import type { MaintenanceJob, Severity, BinType } from './MaintenanceJobDrawer';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

const ISSUE_TYPES = [
  'Damaged lid', 'Bin missing', 'Wheel broken', 'Contamination damage',
  'Bin damaged by vehicle', 'Graffiti', 'Damaged base', 'Bin not returned',
  'Overflow — undersized', 'Replacement requested', 'Lid hinge broken', 'Other',
];

const SUBURBS = [
  'Northgate', 'Stafford', 'Chermside', 'Banyo', 'Nundah',
  'Wavell Heights', 'Kedron', 'Boondall', 'Zillmere', 'Virginia',
];

interface Props {
  onClose: () => void;
  onCreated: (job: MaintenanceJob) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display:'block',fontSize:9.5,fontWeight:700,letterSpacing:'.10em',color:'rgba(255,255,255,.30)',textTransform:'uppercase',marginBottom:6 }}>{label}</label>
      {children}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#F5F7FA',
  fontFamily: FONT, outline: 'none', transition: 'border-color .14s', boxSizing: 'border-box',
};

export default function CreateJobModal({ onClose, onCreated }: Props) {
  const [suburb, setSuburb]         = useState('');
  const [address, setAddress]       = useState('');
  const [binType, setBinType]       = useState<BinType>('GENERAL_WASTE');
  const [issueType, setIssueType]   = useState(ISSUE_TYPES[0]);
  const [issueCustom, setIssueCustom] = useState('');
  const [severity, setSeverity]     = useState<Severity>('MEDIUM');
  const [assignedTo, setAssignedTo] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const resolvedIssue = issueType === 'Other' ? issueCustom : issueType;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!suburb || !address || !resolvedIssue) {
      setError('Suburb, address and issue type are required.');
      return;
    }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bin-maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suburb, address, bin_type: binType, issue_type: resolvedIssue,
          severity, assigned_to: assignedTo || null,
          scheduled_date: scheduledDate || null, notes: notes || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to create job.'); return; }
      const { job } = await res.json();
      onCreated(job as MaintenanceJob);
      onClose();
    } catch {
      // If API fails (no DB), create a local demo job
      const localJob: MaintenanceJob = {
        id: `demo-${Date.now()}`, suburb, address, bin_type: binType,
        issue_type: resolvedIssue, severity, status: 'OPEN',
        assigned_to: assignedTo || null, scheduled_date: scheduledDate || null,
        completed_date: null, notes: notes || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      onCreated(localJob);
      onClose();
    } finally { setLoading(false); }
  }

  const SEV_OPTIONS: { key: Severity; color: string; label: string }[] = [
    { key:'CRITICAL', color:'#EF4444', label:'Critical' },
    { key:'HIGH',     color:'#F97316', label:'High'     },
    { key:'MEDIUM',   color:'#F59E0B', label:'Medium'   },
    { key:'LOW',      color:'#22C55E', label:'Low'      },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes cm-fade { from{opacity:0} to{opacity:1} }
        @keyframes cm-in   { from{opacity:0;transform:translateY(-12px) scale(.97)} to{opacity:1;transform:none} }
        .cm-input:focus { border-color:rgba(139,92,246,.45) !important; }
        .cm-select { appearance:none; }
      `}} />

      {/* Backdrop */}
      <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,.60)',backdropFilter:'blur(3px)',animation:'cm-fade .18s ease' }} />

      {/* Modal */}
      <div style={{
        position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
        zIndex:201,width:520,maxHeight:'90vh',
        display:'flex',flexDirection:'column',
        background:'rgba(6,7,11,.98)',
        border:'1px solid rgba(255,255,255,.10)',
        borderRadius:16,boxShadow:'0 32px 80px rgba(0,0,0,.70)',
        fontFamily:FONT,
        animation:'cm-in .22s cubic-bezier(.16,.84,.44,1)',
        overflow:'hidden',
      }}>

        {/* Header */}
        <div style={{ padding:'18px 24px',borderBottom:'1px solid rgba(255,255,255,.07)',background:'rgba(255,255,255,.015)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0 }}>
          <div>
            <div style={{ fontSize:14.5,fontWeight:700,color:'#F5F7FA',letterSpacing:'-.01em' }}>New Maintenance Job</div>
            <div style={{ fontSize:11,color:'rgba(255,255,255,.30)',marginTop:2 }}>Create operational maintenance record</div>
          </div>
          <button onClick={onClose} style={{ width:30,height:30,borderRadius:8,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.10)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'rgba(255,255,255,.45)',fontSize:16,fontFamily:FONT }}>×</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ flex:1,overflowY:'auto',padding:'20px 24px',display:'flex',flexDirection:'column',gap:14 }}>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
            <Field label="Suburb">
              <select value={suburb} onChange={e=>setSuburb(e.target.value)} className="cm-select" required
                style={{ ...INPUT_STYLE, paddingRight:28, backgroundImage:'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'rgba(255,255,255,.35)\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat:'no-repeat', backgroundPosition:'calc(100% - 10px) center', cursor:'pointer', colorScheme:'dark' }}>
                <option value="">Select suburb…</option>
                {SUBURBS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Address">
              <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Street address…" required className="cm-input" style={INPUT_STYLE} />
            </Field>
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
            <Field label="Bin Type">
              <select value={binType} onChange={e=>setBinType(e.target.value as BinType)} className="cm-select"
                style={{ ...INPUT_STYLE, paddingRight:28, backgroundImage:'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'rgba(255,255,255,.35)\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat:'no-repeat', backgroundPosition:'calc(100% - 10px) center', cursor:'pointer', colorScheme:'dark' }}>
                <option value="GENERAL_WASTE">General Waste</option>
                <option value="RECYCLING">Recycling</option>
                <option value="ORGANICS">Organics</option>
                <option value="BULK_WASTE">Bulk Waste</option>
              </select>
            </Field>
            <Field label="Issue Type">
              <select value={issueType} onChange={e=>setIssueType(e.target.value)} className="cm-select"
                style={{ ...INPUT_STYLE, paddingRight:28, backgroundImage:'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'rgba(255,255,255,.35)\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat:'no-repeat', backgroundPosition:'calc(100% - 10px) center', cursor:'pointer', colorScheme:'dark' }}>
                {ISSUE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          {issueType === 'Other' && (
            <Field label="Custom Issue Type">
              <input value={issueCustom} onChange={e=>setIssueCustom(e.target.value)} placeholder="Describe the issue…" required className="cm-input" style={INPUT_STYLE} />
            </Field>
          )}

          {/* Severity */}
          <Field label="Severity">
            <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:7 }}>
              {SEV_OPTIONS.map(s=>(
                <button type="button" key={s.key} onClick={()=>setSeverity(s.key)} style={{
                  padding:'9px 4px',borderRadius:8,fontSize:10.5,fontWeight:700,letterSpacing:'.06em',
                  textTransform:'uppercase',cursor:'pointer',transition:'all .14s',fontFamily:FONT,
                  background:severity===s.key?`${s.color}18`:'rgba(255,255,255,.03)',
                  border:`1px solid ${severity===s.key?s.color+'35':'rgba(255,255,255,.06)'}`,
                  color:severity===s.key?s.color:'rgba(255,255,255,.30)',
                }}>
                  <div style={{ width:6,height:6,borderRadius:'50%',background:s.color,margin:'0 auto 4px',boxShadow:severity===s.key?`0 0 6px ${s.color}`:'none' }} />
                  {s.label}
                </button>
              ))}
            </div>
          </Field>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
            <Field label="Assign To (optional)">
              <select value={assignedTo} onChange={e=>setAssignedTo(e.target.value)} className="cm-select"
                style={{ ...INPUT_STYLE, paddingRight:28, backgroundImage:'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'rgba(255,255,255,.35)\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")', backgroundRepeat:'no-repeat', backgroundPosition:'calc(100% - 10px) center', cursor:'pointer', colorScheme:'dark' }}>
                <option value="">Unassigned</option>
                {['Sarah Chen','Marcus Webb','Tom Barrett','Priya Kumar','Lisa Okafor','James Nguyen'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Scheduled Date (optional)">
              <input type="date" value={scheduledDate} onChange={e=>setScheduledDate(e.target.value)} className="cm-input"
                style={{ ...INPUT_STYLE, colorScheme:'dark' }} />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Additional operational notes…" rows={3} className="cm-input"
              style={{ ...INPUT_STYLE, resize:'vertical' }} />
          </Field>

          {error && (
            <div style={{ padding:'9px 12px',borderRadius:8,background:'rgba(239,68,68,.10)',border:'1px solid rgba(239,68,68,.20)',fontSize:12,color:'#EF4444' }}>{error}</div>
          )}
        </form>

        {/* Actions */}
        <div style={{ padding:'14px 24px',borderTop:'1px solid rgba(255,255,255,.07)',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0,background:'rgba(0,0,0,.15)' }}>
          <button type="button" onClick={onClose} style={{ padding:'9px 18px',borderRadius:8,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.10)',color:'rgba(255,255,255,.40)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:FONT }}>
            Cancel
          </button>
          <button type="submit" form="" onClick={handleSubmit as unknown as React.MouseEventHandler} disabled={loading} style={{ padding:'9px 20px',borderRadius:8,background:loading?'rgba(139,92,246,.15)':'rgba(139,92,246,.28)',border:'1px solid rgba(139,92,246,.40)',color:loading?'rgba(196,181,253,.40)':'#C4B5FD',fontSize:12,fontWeight:700,cursor:loading?'default':'pointer',fontFamily:FONT,transition:'all .15s' }}>
            {loading ? 'Creating…' : 'Create Job'}
          </button>
        </div>
      </div>
    </>
  );
}
