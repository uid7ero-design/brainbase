import { expect, test } from '@playwright/test';
import { enabled, origin } from './accounts';
import { contextFor, createSchedule, query } from './support';

test.skip(!enabled, 'Requires the disposable Scheduling browser harness');

test('a coach sets up a class schedule and can find it again; other organisations cannot see it', async ({ browser }, info) => {
  const manager = await contextFor(browser, 'manager');
  const viewer = await contextFor(browser, 'viewer');
  const foreign = await contextFor(browser, 'foreign-manager');
  const denied = await contextFor(browser, 'unentitled-manager');
  const className = `Group coaching ${info.project.name}`;
  const appointment = `Individual coaching ${info.project.name}`;
  try {
    await createSchedule(manager.request, appointment, 'appointments');
    const page = await manager.newPage();
    await page.setViewportSize(info.project.use.viewport ?? { width: 1280, height: 800 });
    await page.goto(origin + '/scheduling');
    await page.getByRole('link', { name: 'Coaching workspace' }).click();
    await expect(page.getByRole('link', { name: appointment })).toBeVisible();
    await page.getByRole('button', { name: 'New coaching schedule' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await dialog.getByLabel('Name').fill(className);
    await dialog.getByRole('button', { name: 'Create schedule' }).click();
    await expect(page.getByRole('heading', { name: className })).toBeVisible();
    await page.goto(origin + '/coaching');
    await expect(page.getByRole('link', { name: className })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const staff = await viewer.newPage();
    await staff.goto(origin + '/coaching');
    await expect(staff.getByRole('link', { name: className })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'New coaching schedule' })).toHaveCount(0);
    await expect(staff.getByRole('navigation', { name: 'Client and business tools' })).toHaveCount(0);
    const other = await foreign.newPage();
    await other.goto(origin + '/coaching');
    await expect(other.getByText('No active class or appointment schedules.')).toBeVisible();
    await expect(other.getByRole('link', { name: className })).toHaveCount(0);
    expect((await denied.request.get(origin + '/coaching')).status()).toBe(403);
  } finally {
    await Promise.all([manager.close(), viewer.close(), foreign.close(), denied.close()]);
  }
});

test('business shortcuts follow enabled modules and current staff grants', async ({ browser }) => {
  const context = await contextFor(browser, 'foreign-manager');
  try {
    for (const key of ['invoicing', 'crm', 'purchasing']) {
      await query('INSERT INTO modules(key,name,active) VALUES($1,$1,true) ON CONFLICT (key) DO NOTHING', [key]);
      await query("INSERT INTO organisation_modules(organisation_id,module_key,enabled) VALUES('sched-org-c',$1,true) ON CONFLICT DO NOTHING", [key]);
    }
    await query("UPDATE organisation_user_access SET permissions=$1 WHERE user_id='foreign-manager'", [
      JSON.stringify({ scheduling: 'use', invoicing: 'view', crm: 'view' }),
    ]);
    const page = await context.newPage();
    await page.goto(origin + '/coaching');
    const tools = page.getByRole('navigation', { name: 'Client and business tools' });
    await expect(tools.getByRole('link', { name: 'Client contacts' })).toHaveAttribute('href', '/crm/contacts');
    await expect(tools.getByRole('link', { name: 'Unpaid customer invoices' })).toHaveAttribute('href', '/commercial/invoices/unpaid');
    await expect(tools.getByRole('link', { name: 'Receipt expenses' })).toHaveCount(0);
    await query("UPDATE organisation_user_access SET permissions=$1 WHERE user_id='foreign-manager'", [
      JSON.stringify({ scheduling: 'use', purchasing: 'view' }),
    ]);
    await page.reload();
    await expect(tools.getByRole('link', { name: 'Receipt expenses' })).toHaveAttribute('href', '/commercial/purchasing/receipt-expenses');
    await expect(tools.getByRole('link', { name: 'Unpaid customer invoices' })).toHaveCount(0);
  } finally {
    await query("UPDATE organisation_user_access SET permissions=$1 WHERE user_id='foreign-manager'", [JSON.stringify({ scheduling: 'use' })]);
    await query("DELETE FROM organisation_modules WHERE organisation_id='sched-org-c' AND module_key IN ('invoicing','crm','purchasing')");
    await context.close();
  }
});
