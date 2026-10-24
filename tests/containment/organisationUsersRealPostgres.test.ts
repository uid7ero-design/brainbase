import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const state=vi.hoisted(()=>({pool:null as pg.Pool|null,mails:[] as {to:string;html:string}[]}));
type Query={text:string;values:unknown[];then:PromiseLike<unknown>['then']};
vi.mock('@/lib/db',()=>{
  const tag=(strings:TemplateStringsArray,...values:unknown[]):Query=>{
    const text=strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');
    return {text,values,then(resolve,reject){return state.pool!.query(text,values).then(r=>r.rows).then(resolve,reject);}};
  };
  return {default:Object.assign(tag,{transaction:async(build:(q:typeof tag)=>Query[])=>{
    const client=await state.pool!.connect();try{await client.query('BEGIN');const out=[];for(const q of build(tag))out.push((await client.query(q.text,q.values)).rows);await client.query('COMMIT');return out;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }})};
});
vi.mock('@/lib/email',()=>({BASE_URL:'https://test.invalid',btnStyle:'',EmailSendError:class extends Error{},emailLayout:(s:string)=>s,escHtml:(s:string)=>s.replaceAll('<','&lt;'),sendEmail:async(m:{to:string;html:string})=>{state.mails.push(m);return {status:'sent'};}}));
const {saveOrganisationUser,acceptOrganisationInvitation,listOrganisationUsers}=await import('@/lib/organisationUsers/service');
const actor={userId:'admin-a',organisationId:'a',homeOrganisationId:'a',role:'admin' as const,name:'Admin'};
const invite={action:'invite',name:'New worker',email:'new@example.test',role:'viewer',permissions:{people:'view'}};
const password='Synthetic-invitation-password';
const suite=process.env.ORG_USERS_TEST_DATABASE_URL?describe:describe.skip;
suite('organisation users actual SQL',()=>{
  beforeAll(async()=>{
    const url=process.env.ORG_USERS_TEST_DATABASE_URL!;if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/orgusers$/.test(url))throw Error('Disposable loopback database required');
    state.pool=new pg.Pool({connectionString:url});
    await state.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); // guarded disposable loopback database only
    await state.pool.query(`CREATE TYPE "UserRole" AS ENUM('SUPER_ADMIN','ADMIN','MANAGER','VIEWER');CREATE TYPE "UserStatus" AS ENUM('ACTIVE','INVITED','INACTIVE');
      CREATE TABLE organisations(id text PRIMARY KEY,status text DEFAULT 'ACTIVE');
      CREATE TABLE users(id text PRIMARY KEY,organisation_id text REFERENCES organisations(id),username text UNIQUE,email text UNIQUE,name text,role "UserRole",status "UserStatus" DEFAULT 'ACTIVE',password_hash text,email_verified boolean DEFAULT true,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE modules(key text PRIMARY KEY,name text,active boolean DEFAULT true);CREATE TABLE organisation_modules(organisation_id text,module_key text,enabled boolean);
      CREATE TABLE audit_logs(id text PRIMARY KEY,organisation_id text,user_id text,action text,resource_type text,resource_id text,before_state jsonb,after_state jsonb,created_at timestamptz DEFAULT now());`);
    await state.pool.query(`ALTER TABLE users ADD COLUMN display_name text;
      CREATE TABLE hr_people(id uuid PRIMARY KEY,organisation_id text,linked_user_id text);
      CREATE TABLE hr_employee_documents(id uuid PRIMARY KEY,organisation_id text,person_id uuid,title text,deleted_at timestamptz);
      CREATE TABLE hr_employee_document_versions(id uuid PRIMARY KEY,organisation_id text,document_id uuid,is_current boolean);
      CREATE TABLE hr_administrators(organisation_id text,user_id text);`);
    await state.pool.query(readFileSync('scripts/create-organisation-user-administration.sql','utf8'));
  });
  afterAll(async()=>{await state.pool?.end();});
  beforeEach(async()=>{state.mails.length=0;await state.pool!.query(`TRUNCATE hr_people,hr_employee_documents,hr_employee_document_versions,hr_administrators,organisation_user_invitations,organisation_user_access,audit_logs,users,organisations,modules,organisation_modules CASCADE;
    INSERT INTO organisations(id) VALUES('a'),('b');INSERT INTO users(id,organisation_id,username,email,name,role) VALUES('admin-a','a','admin-a','admin-a@example.test','Admin','ADMIN'),('other-admin','b','other-admin','other@example.test','Other','ADMIN');
    INSERT INTO modules(key,name) VALUES('people','People');INSERT INTO organisation_modules VALUES('a','people',true);`);});
  it('invites without returning token and accepts once under concurrent requests',async()=>{
    const saved=await saveOrganisationUser(actor,invite);expect(saved.delivery).toBe('sent');expect(Object.keys(saved)).toEqual(['id','delivery']);
    const token=state.mails[0].html.match(/#token=([a-f0-9]{64})/)![1];const row=(await state.pool!.query('SELECT token_hash FROM organisation_user_invitations')).rows[0];expect(row.token_hash).not.toBe(token);
    const results=await Promise.allSettled([acceptOrganisationInvitation(token,password),acceptOrganisationInvitation(token,password)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await state.pool!.query('SELECT status FROM users WHERE id=$1',[saved.id])).rows[0].status).toBe('ACTIVE');
    expect((await state.pool!.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='organisation_user.invitation_accepted'")).rows[0].n).toBe(1);
  });
  it('denies cross-tenant target, organisation injection and platform roles',async()=>{
    const change={action:'update',id:'other-admin',name:'Bad',role:'viewer',status:'INACTIVE',permissions:{}};
    await expect(saveOrganisationUser(actor,change)).rejects.toMatchObject({status:409});await expect(saveOrganisationUser(actor,{...invite,organisationId:'b'})).rejects.toMatchObject({status:400});await expect(saveOrganisationUser(actor,{...invite,role:'super_admin'})).rejects.toMatchObject({status:400});
    expect((await listOrganisationUsers(actor)).users.map(u=>u.id)).toEqual(['admin-a']);
  });
  it('rechecks a revoked actor and refuses self changes',async()=>{await state.pool!.query("UPDATE users SET role='VIEWER' WHERE id='admin-a'");await expect(saveOrganisationUser(actor,invite)).rejects.toMatchObject({status:409});await expect(saveOrganisationUser(actor,{...invite,action:'update',id:'admin-a'})).rejects.toMatchObject({status:400});});
  it('serializes concurrent administrator removals and preserves the last one',async()=>{
    await state.pool!.query("INSERT INTO users(id,organisation_id,username,name,role) VALUES('admin-a2','a','admin-a2','Second','ADMIN')");
    const otherActor={...actor,userId:'admin-a2'};const update=(id:string)=>({action:'update',id,name:'Admin',role:'viewer',status:'ACTIVE',permissions:{}});
    const r=await Promise.allSettled([saveOrganisationUser(actor,update('admin-a2')),saveOrganisationUser(otherActor,update('admin-a'))]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await state.pool!.query("SELECT count(*)::int AS n FROM users WHERE organisation_id='a' AND role='ADMIN' AND status='ACTIVE'")).rows[0].n).toBe(1);
  });
  it('invalidates old invitations when explicitly resent and blocks disabled invites',async()=>{
    const saved=await saveOrganisationUser(actor,invite);const token=state.mails[0].html.match(/#token=([a-f0-9]{64})/)![1];
    await saveOrganisationUser(actor,{...invite,id:saved.id,action:'resend'});await expect(acceptOrganisationInvitation(token,password)).rejects.toMatchObject({status:400});
    const newToken=state.mails[1].html.match(/#token=([a-f0-9]{64})/)![1];await saveOrganisationUser(actor,{action:'update',id:saved.id,name:'New',role:'viewer',status:'INACTIVE',permissions:{}});await expect(acceptOrganisationInvitation(newToken,password)).rejects.toMatchObject({status:400});
  });
  it('rejects expired invitations and subscriptions outside the organisation',async()=>{
    await expect(saveOrganisationUser(actor,{...invite,permissions:{events:'use'}})).rejects.toMatchObject({status:400});
    const saved=await saveOrganisationUser(actor,invite);const token=state.mails[0].html.match(/#token=([a-f0-9]{64})/)![1];
    await state.pool!.query("UPDATE organisation_user_invitations SET expires_at=now()-interval '1 second' WHERE user_id=$1",[saved.id]);await expect(acceptOrganisationInvitation(token,password)).rejects.toMatchObject({status:400});
  });
  it('bounds invitation attempts and never sends email when the database quota refuses',async()=>{
    await state.pool!.query("INSERT INTO audit_logs(id,organisation_id,action) SELECT 'quota-'||n,'a','organisation_user.invite' FROM generate_series(1,20) n");
    await expect(saveOrganisationUser(actor,invite)).rejects.toMatchObject({status:409});expect(state.mails).toHaveLength(0);
  });
  it('checks actual HR reminder SQL against current per-user module access',async()=>{
    const p='11111111-1111-4111-8111-111111111111',d='22222222-2222-4222-8222-222222222222',v='33333333-3333-4333-8333-333333333333';
    await state.pool!.query("INSERT INTO hr_people VALUES($1,'a','admin-a');",[p]);await state.pool!.query("INSERT INTO hr_employee_documents(id,organisation_id,person_id,title) VALUES($1,'a',$2,'Synthetic reminder')",[d,p]);await state.pool!.query("INSERT INTO hr_employee_document_versions VALUES($1,'a',$2,true)",[v,d]);
    await state.pool!.query("INSERT INTO organisation_user_access VALUES('admin-a','a','{}',now(),'admin-a')");
    const {createEmployeeDocumentReminderEmailTransport}=await import('@/lib/hr/employeeDocumentReminderEmailTransport');const sender=vi.fn().mockResolvedValue({status:'sent'});
    const transport=createEmployeeDocumentReminderEmailTransport({organisationId:'a',sender});
    const delivery={id:'delivery',documentVersionId:v,recipientUserId:'admin-a',reminderType:'acknowledgement_due',scheduledFor:'2026-10-24',deliveryStatus:'CLAIMED' as const,claimedAt:'2026-10-24',sentAt:null,failedAt:null,failureCode:null};
    expect(await transport(delivery)).toEqual({outcome:'definite_failure',failureCode:'recipient_module_access_unavailable'});expect(sender).not.toHaveBeenCalled();
    await state.pool!.query("UPDATE organisation_user_access SET permissions='{\"people\":\"view\"}' WHERE user_id='admin-a'");expect((await transport(delivery)).outcome).toBe('sent');expect(sender).toHaveBeenCalledTimes(1);
  });
  it('rolls back user and policy if mandatory audit fails',async()=>{
    await state.pool!.query("CREATE FUNCTION reject_org_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test audit failure'; END$$; CREATE TRIGGER reject_org_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_org_audit()");
    try{await expect(saveOrganisationUser(actor,invite)).rejects.toThrow();expect((await state.pool!.query("SELECT count(*)::int AS n FROM users WHERE username='new@example.test'")).rows[0].n).toBe(0);expect(state.mails).toHaveLength(0);}finally{await state.pool!.query('DROP TRIGGER reject_org_audit ON audit_logs;DROP FUNCTION reject_org_audit()');}
  });
});
