import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { build } from 'vite';

// Disposable loopback PostgreSQL only. Actual migrations, readers and aggregates;
// the sole service seam replaces Neon transport with a parameterized pg query.
const container = `brainbase-hr-registers-${process.pid}`;
const artifacts = resolve('test-results/hr-registers-runtime');
mkdirSync(artifacts, { recursive: true });
async function command(binary, args) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', reject); child.on('exit', code => code === 0 ? done(output) : reject(new Error(output)));
  });
}
const port = await new Promise(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => done(value)); }); });
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let pool, created = false;
try {
  await command('docker', ['run', '--name', container, '-e', 'POSTGRES_PASSWORD=test', '-p', `127.0.0.1:${port}:5432`, '-d', 'postgres:16-alpine']); created = true;
  pool = new Pool({ connectionString: `postgresql://postgres:test@127.0.0.1:${port}/postgres` });
  for (let attempt = 0; ; attempt++) { try { await pool.query('SELECT 1'); break; } catch (error) { if (attempt > 30) throw error; await new Promise(done => setTimeout(done, 300)); } }
  await pool.query("CREATE TABLE organisations(id text PRIMARY KEY); CREATE TABLE users(id text PRIMARY KEY);");
  for (const file of ['create-hr-teams.sql', 'create-hr-people.sql', 'create-hr-administrators.sql', 'add-hr-people-tenant-unique.sql', 'create-hr-lifecycle-workflows.sql', 'create-hr-employee-documents.sql', 'create-hr-employee-document-assurance.sql']) await pool.query(readFileSync(`scripts/${file}`, 'utf8'));
  globalThis.__hrRegisterPool = pool;
  const result = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': process.cwd() } }, plugins: [{
    name: 'hr-postgres-transport', enforce: 'pre',
    resolveId(id) {
      if (/\/lib\/db(?:\.ts)?$/.test(id.replaceAll('\\', '/'))) return '\0@/lib/db';
      if (id === 'hr-runtime-entry' || id === 'server-only' || id === '@/lib/db') return `\0${id}`;
    },
    load(id) {
      if (id === '\0server-only') return 'export default {}';
      if (id === '\0@/lib/db') return 'async function sql(strings,...values){const text=strings.reduce((query,part,i)=>query+(i?"$"+i:"")+part,"");return (await globalThis.__hrRegisterPool.query(text,values)).rows;} sql.query=async(text,values)=>{globalThis.__hrRegisterQueryCount=(globalThis.__hrRegisterQueryCount??0)+1;return (await globalThis.__hrRegisterPool.query(text,values)).rows;}; export default sql;';
      if (id === '\0hr-runtime-entry') return `export {loadRegisterPage} from ${JSON.stringify(resolve('lib/hr/registerPageQueries.ts').replaceAll('\\', '/'))}; export {loadLifecycleTaskQueue} from ${JSON.stringify(resolve('lib/hr/lifecycleTaskQueue.ts').replaceAll('\\', '/'))}; export {loadLifecycleOverview} from ${JSON.stringify(resolve('lib/hr/lifecycleOverview.ts').replaceAll('\\', '/'))}; export {loadEmployeeDocumentOverview} from ${JSON.stringify(resolve('lib/hr/employeeDocumentOverview.ts').replaceAll('\\', '/'))};`;
    },
  }], build: { ssr: true, write: false, rollupOptions: { input: 'hr-runtime-entry' } } });
  const bundle = result.output.find(item => item.type === 'chunk');
  const file = resolve(artifacts, 'readers.mjs'); writeFileSync(file, bundle.code);
  const readers = await import(pathToFileURL(file).href);
  await pool.query("INSERT INTO organisations VALUES ('a'),('b'); INSERT INTO users VALUES ('employee'),('manager'),('hr'),('outsider'),('other'); INSERT INTO hr_administrators(organisation_id,user_id) VALUES ('a','hr');");
  for (const [id, org, user, first] of [[1, 'a', 'employee', 'Alex'], [2, 'a', 'manager', 'Morgan'], [3, 'b', 'other', 'Other'], [4, 'a', null, 'Unlinked']]) await pool.query('INSERT INTO hr_people(id,organisation_id,linked_user_id,first_name,last_name) VALUES ($1,$2,$3,$4,$5)', [uuid(id), org, user, first, 'Worker']);
  await pool.query('UPDATE hr_people SET manager_person_id=$1 WHERE id=$2', [uuid(2), uuid(1)]);
  for (const [org, person, template, workflow] of [['a', 1, 10, 20], ['b', 3, 11, 21]]) {
    await pool.query("INSERT INTO hr_lifecycle_templates(id,organisation_id,template_key,version_number,lifecycle_type,name,created_by) VALUES ($1,$2,'fixture',1,'onboarding','Fixture','hr')", [uuid(template), org]);
    await pool.query("INSERT INTO hr_lifecycle_workflows(id,organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by) VALUES ($1,$2,$3,$4,'onboarding','2026-10-09','hr')", [uuid(workflow), org, uuid(person), uuid(template)]);
    for (let i = 0; i < 4; i++) {
      const taskId = template * 100 + i;
      await pool.query("INSERT INTO hr_lifecycle_template_tasks(id,organisation_id,template_id,sequence,title,responsibility_type,employee_visible,manager_visible,internal_only) VALUES ($1,$2,$3,$4,$5,'EMPLOYEE',$6,$6,$7)", [uuid(taskId), org, uuid(template), i + 1, `Task ${i}`, i !== 1, i === 1]);
      await pool.query("INSERT INTO hr_lifecycle_tasks(id,organisation_id,workflow_id,person_id,template_id,template_task_id,sequence,title,responsibility_type,assigned_user_id,due_at,employee_visible,manager_visible,internal_only,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EMPLOYEE','outsider','2026-10-08',$9,$9,$10,$11)", [uuid(taskId + 100), org, uuid(workflow), uuid(person), uuid(template), uuid(taskId), i + 1, `Task ${i}`, i !== 1, i === 1, i === 3 ? 'CANCELLED' : 'NOT_STARTED']);
    }
  }
  for (const [id, org, person, deleted] of [[30, 'a', 1, false], [31, 'a', 1, true], [32, 'b', 3, false], [33, 'a', 4, false], [34, 'a', 1, false]]) await pool.query("INSERT INTO hr_employee_documents(id,organisation_id,person_id,document_type,title,deleted_at) VALUES ($1,$2,$3,'policy','Synthetic policy',CASE WHEN $4 THEN now() ELSE NULL END)", [uuid(id), org, uuid(person), deleted]);
  for (const [id, document, org, current, version, expiry] of [[40, 30, 'a', false, 1, '2020-01-01'], [41, 30, 'a', true, 2, '2026-10-09'], [42, 31, 'a', true, 1, '2020-01-01'], [43, 32, 'b', true, 1, '2020-01-01'], [44, 33, 'a', true, 1, '2026-11-08']]) await pool.query("INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key,expires_at,is_current) VALUES ($1,$2,$3,$4,'hr','fixture.txt','text/plain',1,$5,$6,$7)", [uuid(id), org, uuid(document), version, `synthetic-${id}`, expiry, current]);
  await pool.query("INSERT INTO hr_employee_document_acknowledgements(organisation_id,document_version_id,acknowledged_by) VALUES ('a',$1,'employee'),('a',$2,'outsider')", [uuid(40), uuid(41)]);
  await pool.query("INSERT INTO hr_employee_document_verifications(id,organisation_id,document_version_id,verified_by,decision,verified_at,created_at) VALUES ($1,'a',$3,'hr','VERIFIED','2026-10-08','2026-10-08'),($2,'a',$3,'hr','REJECTED','2026-10-08','2026-10-08')", [uuid(50), uuid(51), uuid(41)]);
  const session = (userId, organisationId = 'a', role = 'viewer') => ({ userId, organisationId, homeOrganisationId: organisationId, role, name: 'Synthetic' });
  const now = new Date('2026-10-09T00:00:00Z');
  const queue = await readers.loadLifecycleTaskQueue(session('employee'), now);
  assert.equal(queue.tasks.length, 2); assert(queue.tasks.every(task => task.person_id === uuid(1) && task.overdue));
  assert.equal((await readers.loadLifecycleTaskQueue(session('manager'), now)).tasks.length, 2);
  assert.equal((await readers.loadLifecycleTaskQueue(session('outsider'), now)).tasks.length, 0);
  assert.equal((await readers.loadLifecycleTaskQueue(session('hr'), now)).tasks.length, 3);
  assert.equal((await readers.loadLifecycleTaskQueue(session('hr', 'b'), now)).tasks.length, 0);
  const overview = await readers.loadLifecycleOverview(session('employee'), now);
  assert.equal(overview.workflows[0].visible_tasks, 3); assert.equal(overview.workflows[0].outstanding_tasks, 2);
  const documents = await readers.loadEmployeeDocumentOverview(session('employee'), now);
  assert.equal(documents.people.length, 1);
  assert.deepEqual(documents.people[0], { person_id: uuid(1), first_name: 'Alex', last_name: 'Worker', documents: 2, missing_version: 1, pending_acknowledgement: 1, unlinked_employee: 0, pending_verification: 0, rejected: 1, expired: 0, expiring_soon: 1 });
  assert.equal((await readers.loadEmployeeDocumentOverview(session('manager'), now)).people.length, 0);
  assert.equal((await readers.loadEmployeeDocumentOverview(session('outsider'), now)).people.length, 0);
  assert.equal((await readers.loadEmployeeDocumentOverview(session('hr', 'b'), now)).people.length, 0);
  const unlinked = (await readers.loadEmployeeDocumentOverview(session('hr'), now)).people.find(person => person.person_id === uuid(4));
  assert.equal(unlinked.unlinked_employee, 1); assert.equal(unlinked.expiring_soon, 1);
  assert.equal((await readers.loadEmployeeDocumentOverview(session('hr', 'b', 'super_admin'), now)).people.length, 1);
  await pool.query("INSERT INTO hr_employee_document_versions(id,organisation_id,document_id,version_number,uploaded_by,original_filename,content_type,byte_size,storage_key,expires_at) VALUES ($1,'a',$2,1,'hr','fixture.txt','text/plain',1,'synthetic-expired','2026-10-08')", [uuid(45), uuid(34)]);
  const expired = (await readers.loadEmployeeDocumentOverview(session('employee'), now)).people[0];
  assert.equal(expired.expired, 1); assert.equal(expired.missing_version, 0); assert.equal(expired.pending_acknowledgement, 2);
  await assert.rejects(pool.query("INSERT INTO hr_employee_documents(organisation_id,person_id,document_type,title) VALUES ('b',$1,'policy','Cross-tenant attempt')", [uuid(1)]), error => error.code === '23503');
  const view = { page: 1, search: '', filter: 'all', lifecycle: 'all' };
  for (const [user, total] of [['employee',2],['manager',2],['outsider',0],['hr',3]]) {
    const page = await readers.loadRegisterPage(session(user), 'queue', view, now);
    assert.equal(page.pagination.total, total); assert.equal(page.tasks.length, total);
    const canonical = await readers.loadLifecycleTaskQueue(session(user), now);
    assert.deepEqual(page.tasks, canonical.tasks);
  }
  assert.deepEqual((await readers.loadRegisterPage(session('employee'), 'overview', view, now)).workflows, overview.workflows);
  assert.deepEqual((await readers.loadRegisterPage(session('employee'), 'documents', view, now)).people, [expired]);
  assert.equal((await readers.loadRegisterPage(session('manager'), 'documents', view, now)).pagination.total, 0);
  assert.equal((await readers.loadRegisterPage(session('hr','b'), 'queue', view, now)).pagination.total, 0);
  assert.equal((await readers.loadRegisterPage(session('hr','b','super_admin'), 'queue', view, now)).pagination.total, 3);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'queue', { ...view, search:'Task 1' }, now)).pagination.total,0);
  assert.equal((await readers.loadRegisterPage(session('hr'), 'queue', { ...view, search:'Task 1' }, now)).pagination.total,1);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'queue', { ...view, filter:'NOT_STARTED' }, now)).pagination.total,2);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'queue', { ...view, filter:'IN_PROGRESS' }, now)).pagination.total,0);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'overview', { ...view, lifecycle:'offboarding' }, now)).pagination.total,0);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'documents', { ...view, filter:'expired' }, now)).pagination.total,1);
  await pool.query('UPDATE hr_lifecycle_tasks SET employee_visible=false,manager_visible=true,due_at=$1 WHERE id=$2', [now,uuid(1100)]);
  assert.equal((await readers.loadRegisterPage(session('employee'), 'queue', view, now)).pagination.total,1);
  const managerPage = await readers.loadRegisterPage(session('manager'), 'queue', view, now);
  assert.equal(managerPage.pagination.total,2);
  assert.equal(managerPage.tasks.find(task=>task.task_id===uuid(1100)).overdue,false);
  await pool.query("UPDATE hr_lifecycle_tasks SET employee_visible=true,due_at='2026-10-08' WHERE id=$1", [uuid(1100)]);
  // 2,000 active workflows/tasks and document owners, all synthetic, same real schema.
  await pool.query(`INSERT INTO hr_people(id,organisation_id,first_name,last_name)
    SELECT md5('person-'||n)::uuid,'a','Volume '||lpad(n::text,4,'0'),'Fixture' FROM generate_series(1,2000) n;
    INSERT INTO hr_employee_documents(id,organisation_id,person_id,document_type,title)
    SELECT md5('doc-'||n)::uuid,'a',md5('person-'||n)::uuid,'policy','Fixture' FROM generate_series(1,2000) n;
    INSERT INTO hr_lifecycle_workflows(id,organisation_id,person_id,template_id,lifecycle_type,anchor_date,started_by)
    SELECT md5('workflow-'||n)::uuid,'a',md5('person-'||n)::uuid,'${uuid(10)}','onboarding','2026-10-09','hr' FROM generate_series(1,2000) n;
    INSERT INTO hr_lifecycle_tasks(id,organisation_id,workflow_id,person_id,template_id,template_task_id,sequence,title,responsibility_type,employee_visible,manager_visible,internal_only,status)
    SELECT md5('task-'||n)::uuid,'a',md5('workflow-'||n)::uuid,md5('person-'||n)::uuid,'${uuid(10)}','${uuid(1000)}',1,'Volume task '||n,'EMPLOYEE',true,true,false,'NOT_STARTED' FROM generate_series(1,2000) n;`);
  const volumeEvidence = [];
  for (const kind of ['overview','queue','documents']) {
    const start = performance.now();
    const beforeQueries = globalThis.__hrRegisterQueryCount;
    const page = await readers.loadRegisterPage(session('hr'), kind, { ...view, search: 'Volume', page: 2 }, now);
    assert.equal(globalThis.__hrRegisterQueryCount - beforeQueries,1);
    const items = page.workflows ?? page.tasks ?? page.people;
    assert.equal(page.pagination.total,2000); assert.equal(page.pagination.page,2); assert.equal(items.length,25);
    assert(Buffer.byteLength(JSON.stringify(page)) < 256*1024);
    const last = await readers.loadRegisterPage(session('hr'), kind, { ...view, search:'Volume', page:999999 }, now);
    assert.equal(last.pagination.page,80);
    const only = await readers.loadRegisterPage(session('hr'), kind, { ...view, search:'Volume 2000' }, now);
    assert.equal(only.pagination.total,1);
    const literal = await readers.loadRegisterPage(session('hr'), kind, { ...view, search:'%' }, now);
    assert.equal(literal.pagination.total,0);
    assert.equal((await readers.loadRegisterPage(session('employee'), kind, { ...view, search:'Volume' }, now)).pagination.total,0);
    volumeEvidence.push({ kind, filtered_rows:2000, returned_rows:items.length, statements_per_page:1, response_bytes:Buffer.byteLength(JSON.stringify(page)), sequence_ms:Math.round(performance.now()-start) });
    console.log(`${kind}: 2000-row filtered paging proof passed in ${Math.round(performance.now()-start)}ms`);
  }
  await pool.query('UPDATE hr_people SET manager_person_id=NULL WHERE id=$1', [uuid(1)]);
  assert.equal((await readers.loadLifecycleTaskQueue(session('manager'), now)).tasks.length, 0);
  assert.equal((await readers.loadRegisterPage(session('manager'), 'queue', view, now)).pagination.total, 0);
  await pool.query("DELETE FROM hr_administrators WHERE organisation_id='a' AND user_id='hr'");
  assert.equal((await readers.loadEmployeeDocumentOverview(session('hr'), now)).people.length, 0);
  assert.equal((await readers.loadRegisterPage(session('hr'), 'documents', view, now)).pagination.total, 0);
  writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify({ passed: true, database: 'disposable PostgreSQL 16', volumeEvidence, checks: ['employee/manager/HR/cross-tenant visibility', 'assigned-user denial', 'manager and HR grant revocation', 'current/deleted/version evidence', 'verification tie-break', 'UTC calendar expiry boundaries', '2000-row paging and exact filtered totals', 'literal wildcard search', 'one statement per page', 'bounded UTF-8 response'] }, null, 2));
  console.log('HR PostgreSQL register checks passed');
} finally {
  delete globalThis.__hrRegisterPool;
  delete globalThis.__hrRegisterQueryCount;
  await pool?.end();
  if (created) await command('docker', ['rm', '-f', container]);
}
