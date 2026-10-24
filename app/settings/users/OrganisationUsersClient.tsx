'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { USER_MODULES,type UserPermissions,type ModuleKey } from '@/lib/organisationUsers/policy';
import { PageHeader,buttonProps } from '@/components/ui/app';
type User={id:string;name:string;email:string;username:string;role:string;status:string;permissions:UserPermissions|null;invitation_expires_at:string|null};
type Module={key:ModuleKey;name:string};
export default function OrganisationUsersClient(){
  const [users,setUsers]=useState<User[]>([]),[modules,setModules]=useState<Module[]>([]),[self,setSelf]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[ready,setReady]=useState(false);
  const [editing,setEditing]=useState<User|null>(null),[showForm,setShowForm]=useState(false),[name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('viewer'),[status,setStatus]=useState('ACTIVE'),[permissions,setPermissions]=useState<UserPermissions>({});
  const pending=useRef(false),generation=useRef(0);
  const invalidate=useCallback(()=>{generation.current++;},[]);
  const load=useCallback(async()=>{const g=++generation.current;setLoading(true);setReady(false);setError('');try{const r=await fetch('/api/organisation/users',{cache:'no-store'});const b=await r.json();if(!r.ok||!Array.isArray(b.users)||!Array.isArray(b.modules))throw Error();if(g!==generation.current)return;setUsers(b.users);setModules(b.modules);setSelf(b.currentUserId);setReady(true);setUncertain(false);setShowForm(false);}catch{if(g===generation.current){setUsers([]);setError('Unable to load users. Refresh to try again.');}}finally{if(g===generation.current)setLoading(false);}},[]);
  useEffect(()=>{let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;invalidate();};},[load,invalidate]);
  function open(user:User|null){setEditing(user);setName(user?.name??'');setEmail(user?.email??'');setRole(user?.role.toLowerCase()??'viewer');setStatus(user?.status==='INACTIVE'?'INACTIVE':'ACTIVE');setPermissions(user?.permissions??(user?Object.fromEntries(modules.map(m=>[m.key,'use'])):{}));setShowForm(true);setNotice('');setError('');}
  async function save(action:'invite'|'update'|'resend',user?:User){
    if(pending.current||uncertain||!ready)return;pending.current=true;setSaving(true);setError('');
    try{const body=user?{action,id:user.id,name:user.name,role:user.role.toLowerCase(),permissions:user.permissions??{}}:{action,id:editing?.id,name,email,role,status,permissions};
      const r=await fetch('/api/organisation/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const b=await r.json();
      if(!r.ok){if(r.status>=500)throw Error();setError(b.error??'Unable to save.');return;}
      if(typeof b.id!=='string')throw Error();
      setNotice(b.delivery==='sent'?'Saved. Invitation sent.':b.delivery==='unconfirmed'?'User saved. Email delivery is unconfirmed. Review the user before choosing Send new invitation.':'Access saved.');await load();
    }catch{setUncertain(true);setReady(false);setError('The save result is unknown. Refresh users and check the saved account before trying again.');}
    finally{pending.current=false;setSaving(false);}
  }
  return <main style={{maxWidth:1100,margin:'0 auto',padding:24}}><PageHeader title="Organisation users" description="Invite staff and control access within your organisation." actions={<button {...buttonProps('secondary')} disabled={saving||loading} onClick={()=>void load()}>Refresh users</button>}/>
    <p>Roles set the level of responsibility. Module access can only narrow existing permissions; HR grants, restricted cases and approvals keep their separate rules.</p>
    <p><a href="/workspace">My workspace</a></p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {loading?<p>Loading users…</p>:<><button {...buttonProps('primary')} disabled={!ready||saving||uncertain} onClick={()=>open(null)}>Invite user</button>
      <table style={{width:'100%',marginTop:20}}><caption>Users in your organisation</caption><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.name}{u.id===self?' (you)':''}</td><td>{u.username}</td><td>{u.role.toLowerCase()}</td><td>{u.status.toLowerCase()}</td><td><button disabled={saving||!ready||uncertain||u.id===self} onClick={()=>open(u)}>Edit access for {u.name}</button>{u.status==='INVITED'&&<button disabled={saving||!ready||uncertain} onClick={()=>{if(window.confirm('Send a new invitation? The previous link will stop working.'))void save('resend',u);}}>Send new invitation to {u.name}</button>}</td></tr>)}</tbody></table>
    </>}
    {showForm&&<section style={{marginTop:24,border:'1px solid var(--border-subtle)',padding:20}}><h2>{editing?'Edit user access':'Invite a user'}</h2><form onSubmit={e=>{e.preventDefault();void save(editing?'update':'invite');}}>
      <fieldset disabled={saving||uncertain||!ready} style={{display:'grid',gap:14,border:0}}>
        <label>Name <input required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Email / username <input type="email" required disabled={!!editing} value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Role <select value={role} onChange={e=>setRole(e.target.value)}><option value="viewer">Viewer — read permitted information</option><option value="manager">Manager — operational changes where permitted</option><option value="admin">Organisation administrator — approvals and user administration</option></select></label>
        {editing&&<label>Account status <select value={status} onChange={e=>setStatus(e.target.value)}><option value="ACTIVE">Active (unaccepted invitations remain invited)</option><option value="INACTIVE">Inactive — block sign-in access</option></select></label>}
        <p>New users start with no module access. “Use module” still respects their role and record-level permissions. Organisation administrators can manage these user settings.</p>
        {editing?.permissions===null&&<p>This existing account uses its previous module permissions. Saving here switches it to the explicit choices below.</p>}
        {modules.length===0&&<p>No supported modules are enabled for this organisation. Ask the platform administrator about subscriptions.</p>}
        {modules.map(m=><label key={m.key}>{USER_MODULES[m.key]?.name??m.name} <select aria-label={`Access to ${m.name}`} value={permissions[m.key]??'none'} onChange={e=>setPermissions(p=>({...p,[m.key]:e.target.value as 'none'|'view'|'use'}))}><option value="none">No access</option><option value="view">View only</option><option value="use">Use module (within role)</option></select></label>)}
        <button {...buttonProps('primary')} type="submit">{saving?'Saving…':editing?'Save access':'Create and send invitation'}</button>
        <button type="button" onClick={()=>setShowForm(false)}>Cancel</button>
      </fieldset>
    </form></section>}
  </main>;
}
