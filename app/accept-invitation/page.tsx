'use client';
import { useState } from 'react';
import Link from 'next/link';
export default function AcceptInvitation() {
  const [password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[done,setDone]=useState(false);
  return <main style={{maxWidth:480,margin:'64px auto',padding:24}}><h1>Join your organisation</h1>
    <p>Choose your own password. Your administrator controls your organisation access.</p>
    {done?<><p>Your account is ready.</p><Link href="/login">Sign in to BrainBase</Link></>:<form onSubmit={async event=>{
      event.preventDefault();if(busy)return;setBusy(true);setMessage('');
      const token=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
      try{const r=await fetch('/api/auth/accept-invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});const b=await r.json();if(!r.ok)throw Error(b.error);setDone(true);setPassword('');window.history.replaceState(null,'','/accept-invitation');}
      catch(e){setMessage(e instanceof Error?e.message:'Unable to accept invitation.');}finally{setBusy(false);}
    }}><label>New password<input style={{display:'block',width:'100%',margin:'12px 0'}} type="password" minLength={12} maxLength={200} autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
      <p>Use at least 12 characters.</p><button disabled={busy}>{busy?'Setting up…':'Accept invitation'}</button></form>}
    {message&&<p role="alert">{message}</p>}</main>;
}
