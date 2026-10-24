import Link from 'next/link';
import { requireSession } from '@/lib/org';
import { redirect } from 'next/navigation';
import { visibleCapabilities } from '@/lib/organisationUsers/access';
import { USER_MODULES,type ModuleKey } from '@/lib/organisationUsers/policy';
export default async function Workspace(){
  let actor;try{actor=await requireSession();}catch{redirect('/login');}
  const modules=await visibleCapabilities(actor.organisationId,actor.userId,actor.role);
  return <main style={{maxWidth:900,margin:'0 auto',padding:24}}><h1>My workspace</h1><p>Open the areas available to your account. Your role and record permissions still apply.</p>
    <ul>{modules.filter(m=>m.key in USER_MODULES).map(m=><li key={String(m.key)}><Link href={USER_MODULES[m.key as ModuleKey].path}>{String(m.name)}</Link></li>)}</ul>
    {modules.length===0&&<p>No modules are available. Ask your organisation administrator to review your access.</p>}
    {['admin','super_admin'].includes(actor.role)&&<p><Link href="/settings/users">Manage organisation users</Link></p>}<Link href="/account/profile">My profile</Link></main>;
}
