import { expect, test } from '@playwright/test';
import { enabled, origin } from './accounts';
import { api, contextFor, createOffering, createResource, createSchedule, query } from './support';

test.skip(!enabled, 'Requires disposable Scheduling harness');

test('a football squad trains across terms and a transfer preserves the original attendance', async ({
  browser,
}, info) => {
  const manager = await contextFor(browser, 'manager');
  const viewer = await contextFor(browser, 'viewer');
  const other = await contextFor(browser, 'foreign-manager');
  try {
    const page = await manager.newPage();
    await page.setViewportSize(info.project.use.viewport ?? { width: 1440, height: 900 });
    const schedule = await createSchedule(manager.request, 'Football ' + info.project.name);
    const pitch = await createResource(manager.request, 'Pitch 2 ' + info.project.name, 'space');
    const offering = await createOffering(manager.request, schedule.id, 'U12 training', {
      durationMinutes: 60,
      capacity: 1,
      priceCents: 1000,
    });
    expect(
      (
        await manager.request.post(api('/offerings/' + offering.id + '/resources'), {
          data: { resourceId: pitch.id },
        })
      ).status(),
    ).toBe(201);
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const first = day(7),
      second = day(14),
      next = day(28);
    const terms = [
      'Autumn ' + info.project.name,
      'Winter ' + info.project.name,
      'Development ' + info.project.name,
    ];
    for (const [name, start, end, time] of [
      [terms[0], first, second, '15:00'],
      [terms[1], next, day(35), '15:00'],
      [terms[2], next, day(35), '17:00'],
    ]) {
      await page.goto(origin + '/coaching/calendar?week=' + start);
      await page.getByLabel('Schedule type').selectOption('term');
      await page.getByLabel('Class and location').selectOption(JSON.stringify([offering.id, pitch.id]));
      await page.getByLabel('Class date', { exact: true }).fill(start);
      await page.getByLabel('Local start time').fill(time);
      await page.getByLabel('Term name').fill(name);
      await page.getByLabel('Term ends on').fill(end);
      await page.getByRole('button', { name: 'Create term' }).click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    }
    await page.goto(origin + '/coaching');
    await page.getByRole('link', { name: 'Teams and squads' }).click();
    const teams = ['U12 Blues ' + info.project.name, 'U12 Reds ' + info.project.name];
    for (const team of teams) {
      await page.getByLabel('Squad name').fill(team);
      await page.getByRole('button', { name: 'Create squad' }).click();
      await expect(page.getByRole('link', { name: team })).toBeVisible();
    }
    const open = async (name: string) => {
      await page.getByRole('navigation', { name: 'Choose squad' }).getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    };
    const assign = async (index: number) => {
      const select = page.getByRole('combobox', { name: /Training term/ });
      const opt = select.locator('option').filter({ hasText: terms[index] });
      await select.selectOption((await opt.getAttribute('value')) as string);
      await page.getByRole('button', { name: 'Assign training term' }).click();
      await expect(page.getByRole('link').filter({ hasText: terms[index] })).toBeVisible();
    };
    await open(teams[1]);
    await assign(2);
    await open(teams[0]);
    await assign(0);
    await page.getByLabel('Player name').fill('Junior Player');
    await page.getByLabel('Booking email').fill('player@example.test');
    await page.getByLabel('Joining date').fill(second);
    await page.getByRole('button', { name: 'Add player' }).click();
    await expect(page.getByRole('heading', { name: 'Junior Player' })).toBeVisible();
    await page.getByLabel('Player name').fill('Overflow player');
    await page.getByLabel('Booking email').fill('overflow@example.test');
    await page.getByLabel('Joining date').fill(first);
    await page.getByRole('button', { name: 'Add player' }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText('Change declined');
    await expect(page.getByRole('heading', { name: 'Overflow player' })).toHaveCount(0);
    await assign(1);
    const teamUrl = page.url();
    const reservations = () =>
      query<{ id: string; day: string; status: string; attendance: string | null }>(
        'SELECT occurrence_id AS id,local_start_date::text AS day,status,attendance FROM scheduling_reservations WHERE offering_id=$1 AND customer_email=$2 ORDER BY starts_at',
        [offering.id, 'player@example.test'],
      );
    const before = await reservations();
    expect(before.map((r) => r.day)).toEqual([second, next, day(35)]);
    await page.goto(origin + '/coaching/roster/' + before[0].id);
    await page.getByRole('button', { name: 'Mark attended' }).click();
    await expect(page.getByText('confirmed · attended')).toBeVisible();
    for (const ctx of [viewer, other]) {
      const restricted = await ctx.newPage();
      await restricted.goto(teamUrl);
      await expect(restricted.getByText('player@example.test')).toHaveCount(0);
      await expect(restricted.getByRole('button', { name: 'Add player' })).toHaveCount(0);
    }
    await page.goto(teamUrl);
    await open(teams[1]);
    // Occupy only the final destination date so a failed transfer must undo earlier writes.
    await page.getByLabel('Player name').fill('Destination player');
    await page.getByLabel('Booking email').fill('blocker@example.test');
    await page.getByLabel('Joining date').fill(day(35));
    await page.getByRole('button', { name: 'Add player' }).click();
    await expect(page.getByRole('heading', { name: 'Destination player' })).toBeVisible();
    await open(teams[0]);
    await page.getByText('End or transfer membership').click();
    await page.getByLabel('Destination').selectOption({ label: teams[1] });
    await page.getByLabel('First day outside this squad').fill(second);
    await page.getByRole('button', { name: 'Save membership change' }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText(
      'Review the roster and effective date',
    );
    expect(await reservations()).toHaveLength(3);
    await page.getByLabel('Destination').selectOption({ label: teams[1] });
    await page.getByLabel('First day outside this squad').fill(next);
    await page.getByRole('button', { name: 'Save membership change' }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText('Change declined');
    expect((await reservations()).map((r) => r.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    await open(teams[1]);
    await page.getByText('End or transfer membership').click();
    await page.getByLabel('First day outside this squad').fill(day(35));
    await page.getByRole('button', { name: 'Save membership change' }).click();
    await expect(page.getByText(/Withdrawn before starting/)).toBeVisible();
    await open(teams[0]);
    await page.getByText('End or transfer membership').click();
    await page.getByLabel('Destination').selectOption({ label: teams[1] });
    await page.getByLabel('First day outside this squad').fill(next);
    await page.getByRole('button', { name: 'Save membership change' }).click();
    await expect(page.getByText('End or transfer membership')).toHaveCount(0);
    await open(teams[1]);
    await expect(page.getByRole('heading', { name: 'Junior Player' })).toBeVisible();
    // The transferred player's history belongs to the original squad and term.
    await query("UPDATE scheduling_occurrences SET status='completed' WHERE id=$1 AND offering_id=$2", [
      before[0].id,
      offering.id,
    ]);
    await open(teams[0]);
    await page.getByRole('link', { name: new RegExp('^Review .*' + terms[0]) }).click();
    const reviewUrl = page.url();
    await expect(page.getByRole('heading', { name: teams[0] + ' term review' })).toBeVisible();
    await expect(page.getByText('100% present across 1 marked squad place')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Player attendance' }).getByRole('listitem')).toContainText(
      'Junior Player',
    );
    await expect(page.getByRole('link', { name: 'Open roster' })).toHaveAttribute(
      'href',
      '/coaching/roster/' + before[0].id,
    );
    for (const denied of [viewer, other]) {
      const tab = await denied.newPage();
      await tab.goto(reviewUrl);
      await expect(tab.getByRole('heading', { name: 'Player attendance' })).toHaveCount(0);
      await tab.close();
    }
    await page.getByRole('link', { name: 'Back to ' + teams[0] }).click();
    await page.getByRole('link', { name: new RegExp('^Review .*' + terms[1]) }).click();
    await expect(page.getByRole('region', { name: 'Term sessions' }).getByText(/0 squad places/)).toHaveCount(
      2,
    );
    await expect(page.getByRole('link', { name: 'Prepare plan' })).toHaveCount(2);
    const after = await reservations();
    expect(after.map((r) => [r.day, r.status, r.attendance])).toEqual([
      [second, 'confirmed', 'attended'],
      [next, 'cancelled', null],
      [next, 'confirmed', null],
      [day(35), 'cancelled', null],
      [day(35), 'confirmed', null],
    ]);
    await page.goto(origin + '/coaching/roster/' + before[0].id);
    await expect(page.getByText('confirmed · attended')).toBeVisible();
    await expect(page.getByText(teams[0], { exact: false })).toBeVisible();
    await page.goto(origin + '/coaching/calendar?week=' + next);
    for (const team of teams) await expect(page.locator('article').filter({ hasText: team })).toBeVisible();
  } finally {
    await Promise.all([manager.close(), viewer.close(), other.close()]);
  }
});
