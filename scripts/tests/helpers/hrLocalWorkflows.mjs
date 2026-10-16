import assert from 'node:assert/strict';
import { expect as browserExpect } from '@playwright/test';

// A development server compiles newly visited routes on demand.
const expect = browserExpect.configure({ timeout: 30000 });

// Called only inside verify-hr-full-local's owned database/app lifetime.
// Requests retain real browser-issued sessions and run the actual Next routes.
export async function verifyRemainingWorkflows({ origin, context, page, employeeContext, employeePage, person, q, emails, cronSecret, password, browser }) {
  const api = context.request, employee = employeeContext.request;
  async function check(response, status) {
    assert.equal(response.status(), status, await response.text());
    return response.json();
  }
  const templatePayload = { template_key: 'full-local', lifecycle_type: 'onboarding', name: 'Local acceptance workflow', tasks: [{ sequence: 1, title: 'Local employee approval task', responsibility_type: 'EMPLOYEE', requires_approval: true, approval_type: 'HR_ADMIN', employee_visible: true, manager_visible: false, internal_only: false }] };
  await check(await employee.post(`${origin}/api/hr/lifecycle/templates`, { data: templatePayload }), 403);
  const templateId = (await check(await api.post(`${origin}/api/hr/lifecycle/templates`, { data: templatePayload }), 201)).template.id;
  const templateUrl = `${origin}/api/hr/lifecycle/templates/${templateId}`;
  await check(await api.post(`${templateUrl}/activate`), 200);
  assert.ok((await check(await api.get(`${origin}/api/hr/lifecycle/templates?status=ACTIVE`), 200)).templates.some(t => t.id === templateId));
  await page.goto(`${origin}/people`);
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await page.locator('label').filter({ hasText: 'Template' }).locator('select').selectOption(templateId);
  await page.getByLabel('Anchor date', { exact: true }).fill('2026-10-16');
  const started = page.waitForResponse(r => r.url() === `${origin}/api/hr/lifecycle/workflows` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const startedBody = await check(await started, 201);
  const workflowId = startedBody.workflow.id, taskId = startedBody.tasks[0].id;
  const workflowUrl = `${origin}/api/hr/lifecycle/workflows/${workflowId}`;
  const taskUrl = `${origin}/api/hr/lifecycle/tasks/${taskId}`;
  await check(await api.post(`${origin}/api/hr/lifecycle/workflows`, { data: { person_id: person.id, template_id: templateId, anchor_date: '2026-10-16' } }), 409);
  await check(await employee.post(`${origin}/api/hr/lifecycle/workflows`, { data: { person_id: person.id, template_id: templateId, anchor_date: '2026-10-16' } }), 403);
  await employeePage.goto(`${origin}/people`);
  await employeePage.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await employeePage.getByRole('button', { name: 'View tasks', exact: true }).click();
  await employeePage.getByRole('button', { name: 'Start task', exact: true }).click();
  await expect(employeePage.getByRole('button', { name: 'Start task', exact: true })).toHaveCount(0);
  await employeePage.getByRole('button', { name: 'Complete task', exact: true }).click();
  await expect.poll(async () => (await q('SELECT status FROM hr_lifecycle_tasks WHERE id=$1', [taskId])).rows[0].status).toBe('AWAITING_APPROVAL');
  await check(await employee.post(`${taskUrl}/approvals`, { data: { decision: 'APPROVED' } }), 403);
  await page.reload();
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await page.getByRole('button', { name: 'View tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect.poll(async () => (await q('SELECT status FROM hr_lifecycle_tasks WHERE id=$1', [taskId])).rows[0].status).toBe('IN_PROGRESS');
  await check(await employee.patch(taskUrl, { data: { action: 'complete' } }), 200);
  await page.reload();
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await page.getByRole('button', { name: 'View tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(async () => (await q('SELECT status FROM hr_lifecycle_workflows WHERE id=$1', [workflowId])).rows[0].status).toBe('COMPLETED');
  assert.equal((await check(await api.get(workflowUrl), 200)).workflow.status, 'COMPLETED');
  assert.equal((await q('SELECT count(*)::int AS n FROM hr_lifecycle_task_approvals WHERE task_id=$1', [taskId])).rows[0].n, 2);
  await check(await api.post(`${taskUrl}/approvals`, { data: { decision: 'APPROVED' } }), 409);
  const next = await check(await api.post(`${origin}/api/hr/lifecycle/workflows`, { data: { person_id: person.id, template_id: templateId, anchor_date: '2026-10-16' } }), 201);
  await check(await employee.post(`${origin}/api/hr/lifecycle/workflows/${next.workflow.id}/cancel`), 403);
  const cancelUrl = `${origin}/api/hr/lifecycle/workflows/${next.workflow.id}/cancel`;
  let cancellations = 0;
  await page.route(cancelUrl, async route => {
    assert.equal((await route.fetch()).status(), 200);
    cancellations++;
    await route.abort('failed');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancel', exact: true }).click();
  await expect(page.getByText(/Workflow cancellation outcome is unknown/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm cancel', exact: true })).toBeDisabled();
  await page.unroute(cancelUrl);
  await page.reload();
  await page.getByRole('button', { name: 'Local Employee', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel workflow', exact: true })).toHaveCount(0);
  assert.equal(cancellations, 1);
  assert.equal((await q('SELECT status FROM hr_lifecycle_workflows WHERE id=$1', [next.workflow.id])).rows[0].status, 'CANCELLED');
  await check(await employee.patch(`${origin}/api/hr/lifecycle/tasks/${next.tasks[0].id}`, { data: { action: 'complete' } }), 409);
  const versionPayload = { name: templatePayload.name, tasks: templatePayload.tasks };
  const version = await check(await api.post(`${templateUrl}/versions`, { data: { ...versionPayload, name: 'Local workflow revision' } }), 201);
  assert.equal(version.template.version_number, 2);
  await check(await api.post(`${templateUrl}/retire`), 200);
  await check(await api.post(`${origin}/api/hr/lifecycle/templates/${version.template.id}/activate`), 200);
  assert.equal((await check(await api.get(workflowUrl), 200)).workflow.template_id, templateId);
  console.log('PASS: real browser workflow start, employee start/submit, HR reject/resubmit/approve, immutable approval history, duplicate denial and cancellation.');

  const manager = (await q("INSERT INTO hr_people(organisation_id,linked_user_id,first_name,last_name) VALUES('local-hr','local-manager','Local','Manager') RETURNING id")).rows[0];
  await q('UPDATE hr_people SET manager_person_id=$1 WHERE id=$2', [manager.id, person.id]);
  const managerTemplate = (await check(await api.post(`${origin}/api/hr/lifecycle/templates`, { data: {
    template_key: 'full-local-manager', lifecycle_type: 'offboarding', name: 'Local manager workflow', tasks: [
      { sequence: 1, title: 'Local manager task', responsibility_type: 'MANAGER', requires_approval: false, approval_type: 'NONE', employee_visible: false, manager_visible: true, internal_only: false },
      { sequence: 2, title: 'Private HR exit task', responsibility_type: 'HR_ADMIN', requires_approval: false, approval_type: 'NONE', employee_visible: false, manager_visible: false, internal_only: true },
    ],
  } }), 201)).template;
  await check(await api.post(`${origin}/api/hr/lifecycle/templates/${managerTemplate.id}/activate`), 200);
  const managerWorkflow = await check(await api.post(`${origin}/api/hr/lifecycle/workflows`, { data: { person_id: person.id, template_id: managerTemplate.id, anchor_date: '2026-10-16' } }), 201);
  const managerContext = await browser.newContext();
  await managerContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  const managerPage = await managerContext.newPage();
  await managerPage.goto(`${origin}/login`);
  await managerPage.getByLabel('Username', { exact: true }).fill('local-manager');
  await managerPage.getByLabel('Password', { exact: true }).fill(password);
  await managerPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(async () => (await managerContext.cookies()).some(c => c.name === 'session')).toBe(true);
  await managerPage.goto(`${origin}/people/lifecycle/tasks`);
  await expect(managerPage.getByText('Local manager task', { exact: true })).toBeVisible();
  await expect(managerPage.getByText('Private HR exit task', { exact: true })).toHaveCount(0);
  const managerDetailUrl = `${origin}/api/hr/lifecycle/workflows/${managerWorkflow.workflow.id}`;
  const managerView = await check(await managerContext.request.get(managerDetailUrl), 200);
  assert.equal(managerView.tasks.length, 1);
  assert.equal(managerView.tasks[0].capabilities.can_execute, true);
  const managerTask = managerView.tasks[0].id;
  const hrTask = managerWorkflow.tasks.find(t => t.title === 'Private HR exit task').id;
  await check(await managerContext.request.patch(`${origin}/api/hr/lifecycle/tasks/${hrTask}`, { data: { action: 'complete' } }), 404);
  await check(await employee.patch(`${origin}/api/hr/lifecycle/tasks/${managerTask}`, { data: { action: 'complete' } }), 404);
  await check(await managerContext.request.patch(`${origin}/api/hr/lifecycle/tasks/${managerTask}`, { data: { action: 'start' } }), 200);
  await q('UPDATE hr_people SET manager_person_id=NULL WHERE id=$1', [person.id]);
  await check(await managerContext.request.patch(`${origin}/api/hr/lifecycle/tasks/${managerTask}`, { data: { action: 'complete' } }), 404);
  await q('UPDATE hr_people SET manager_person_id=$1 WHERE id=$2', [manager.id, person.id]);
  await check(await managerContext.request.patch(`${origin}/api/hr/lifecycle/tasks/${managerTask}`, { data: { action: 'complete' } }), 200);
  await check(await api.patch(`${origin}/api/hr/lifecycle/tasks/${hrTask}`, { data: { action: 'waive', reason: 'Synthetic acceptance waiver' } }), 200);
  assert.equal((await check(await api.get(managerDetailUrl), 200)).workflow.status, 'COMPLETED');
  await managerContext.close();
  console.log('PASS: real manager login, rendered queue excludes internal tasks, current direct-manager execution/revocation and HR waiver complete offboarding.');

  // Management changes use actual HTTP writes; fresh reads verify persisted authority.
  await check(await employee.post(`${origin}/api/hr/teams`, { data: { name: 'Denied team' } }), 403);
  const team = (await check(await api.post(`${origin}/api/hr/teams`, { data: { name: 'Local acceptance team' } }), 201)).team;
  await check(await api.patch(`${origin}/api/hr/teams/${team.id}`, { data: { name: 'Local renamed team' } }), 200);
  await check(await api.post(`${origin}/api/hr/teams/${team.id}/archive`), 200);
  assert.ok(!(await check(await api.get(`${origin}/api/hr/teams`), 200)).teams.some(t => t.id === team.id));
  await check(await employee.get(`${origin}/api/hr/teams?include_archived=1`), 403);
  await check(await api.post(`${origin}/api/hr/teams/${team.id}/restore`), 200);
  assert.ok((await check(await api.get(`${origin}/api/hr/teams`), 200)).teams.some(t => t.id === team.id && t.name === 'Local renamed team'));
  await check(await employee.get(`${origin}/api/hr/administrators`), 403);
  await check(await api.post(`${origin}/api/hr/administrators`, { data: { user_id: 'local-employee' } }), 201);
  assert.equal((await check(await employee.get(`${origin}/api/hr/people`), 200)).canManage, true);
  await check(await api.delete(`${origin}/api/hr/administrators?userId=local-employee`), 200);
  assert.equal((await check(await employee.get(`${origin}/api/hr/people`), 200)).canManage, false);
  console.log('PASS: real team create/rename/archive/restore and administrator grant/revoke with current-session permission refresh.');

  const created = await check(await api.post(`${origin}/api/hr/restricted-cases`, { data: { case_type: 'other', title: 'Local restricted acceptance' } }), 201);
  const caseId = created.case.id, caseUrl = `${origin}/api/hr/restricted-cases/${caseId}`;
  await check(await api.get(caseUrl), 404); // General HR status never implies case read.
  await check(await api.post(`${caseUrl}/access`, { data: { user_id: 'local-admin' } }), 201);
  await check(await api.get(caseUrl), 200);
  await check(await employee.get(caseUrl), 404);
  await check(await api.post(`${caseUrl}/access`, { data: { user_id: 'local-employee' } }), 201);
  await check(await employee.get(caseUrl), 200);
  await page.goto(`${origin}/people/restricted-cases/${caseId}`);
  await expect(page.getByRole('heading', { name: 'Local restricted acceptance', exact: true })).toBeVisible();
  // Let the real write commit, then drop its response. Recovery must not replay it.
  let committed = false;
  await page.route(`${caseUrl}/notes`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const result = await route.fetch();
    assert.equal(result.status(), 201);
    committed = true;
    await route.abort('failed');
  });
  await page.getByRole('textbox', { name: 'New case note', exact: true }).fill('Local committed note');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeDisabled();
  await expect.poll(() => committed).toBe(true);
  await expect(page.getByText('The change could not be confirmed. Refresh and review the case before trying again.', { exact: true })).toBeVisible();
  await page.unroute(`${caseUrl}/notes`);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Local committed note', { exact: true })).toBeVisible();
  assert.equal((await q('SELECT count(*)::int AS n FROM hr_restricted_case_notes WHERE case_id=$1', [caseId])).rows[0].n, 1);
  const restrictedUpload = await check(await api.post(`${caseUrl}/documents`, { multipart: { file: { name: 'restricted.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Local restricted bytes') } } }), 201);
  const restrictedDocumentUrl = `${caseUrl}/documents/${restrictedUpload.document.id}`;
  assert.equal((await (await employee.get(restrictedDocumentUrl)).body()).toString(), 'Local restricted bytes');
  await check(await api.post(`${caseUrl}/participants`, { data: { person_id: person.id, role_in_case: 'subject' } }), 201);
  await check(await api.delete(`${caseUrl}/participants/${person.id}`), 200);
  await check(await api.delete(`${caseUrl}/access/local-employee`), 200);
  await check(await employee.get(caseUrl), 404);
  await check(await employee.get(restrictedDocumentUrl), 404);
  await check(await api.delete(restrictedDocumentUrl), 200);
  await check(await api.get(restrictedDocumentUrl), 404);
  assert.ok(!(await check(await employee.get(`${origin}/api/hr/restricted-cases`), 200)).cases.some(c => c.id === caseId));
  await q(`CREATE FUNCTION local_deny_read_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='hr_restricted_case.read' THEN RAISE EXCEPTION 'local synthetic read audit failure'; END IF; RETURN NEW; END $$`);
  await q('CREATE TRIGGER local_read_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION local_deny_read_audit()');
  const blocked = await api.get(caseUrl);
  assert.equal(blocked.status(), 503);
  assert.ok(!(await blocked.text()).includes('Local restricted acceptance'));
  await q('DROP TRIGGER local_read_audit_failure ON audit_logs');
  await check(await api.get(caseUrl), 200);
  console.log('PASS: restricted creation without implicit read, explicit grant/revoke, real page lost-note recovery without replay, and fail-closed read audit failure/recovery.');

  // The public cron consumes pre-scheduled ledger rows; scheduling-service
  // concurrency remains covered by the separate disposable integration suite.
  await q("UPDATE users SET email='employee@local.invalid' WHERE id='local-employee'");
  const document = await check(await api.post(`${origin}/api/hr/people/${person.id}/documents`, { multipart: { document_type: 'policy', title: 'Local reminder policy', file: { name: 'reminder.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Local reminder bytes') } } }), 201);
  const reminderBase = `${origin}/api/hr/people/${person.id}/documents/${document.document.id}`;
  const current = await check(await api.post(`${reminderBase}/versions`, { multipart: { file: { name: 'current.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Current reminder bytes') } } }), 201);
  for (const [date, version, recipient] of [
    ['2020-01-01', current.version.id, 'local-employee'],
    ['2020-01-02', current.version.id, 'local-employee'],
    ['2020-01-03', current.version.id, 'local-employee'],
    ['2020-01-04', document.version.id, 'local-employee'],
    ['2020-01-05', current.version.id, 'local-employee'],
    ['2020-01-06', current.version.id, 'local-admin'],
  ]) {
    await q(`INSERT INTO hr_employee_document_reminder_deliveries(organisation_id,document_version_id,recipient_user_id,reminder_type,scheduled_for)
      VALUES('local-hr',$1,$2,'acknowledgement_due',$3)`, [version, recipient, date]);
  }
  await q("UPDATE users SET email='admin@local.invalid' WHERE id='local-admin'");
  await check(await api.delete(`${origin}/api/hr/administrators?userId=local-admin`), 200);
  const cron = `${origin}/api/cron/hr-employee-document-reminders`;
  await check(await api.get(cron), 401);
  const summary = await check(await api.get(cron, { headers: { Authorization: `Bearer ${cronSecret}` } }), 200);
  assert.equal(summary.claimed, 6);
  assert.equal(summary.sent, 2);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.failed, 3); // Provider rejection, historical version and revoked access.
  assert.equal(emails.length, 4); // Obsolete version never reaches sender; later row progresses.
  const ledger = (await q('SELECT delivery_status FROM hr_employee_document_reminder_deliveries ORDER BY scheduled_for')).rows.map(r => r.delivery_status);
  assert.deepEqual(ledger, ['SENT', 'CLAIMED', 'FAILED', 'FAILED', 'SENT', 'FAILED']);
  const again = await check(await api.get(cron, { headers: { Authorization: `Bearer ${cronSecret}` } }), 200);
  assert.equal(again.claimed, 0);
  assert.equal(emails.length, 4);
  console.log('PASS: actual cron auth, current-version reminder entitlement, local HTTP sender success/rejection/ambiguous failure, later-row progress and no replay.');
}
