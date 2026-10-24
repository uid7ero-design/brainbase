import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulesManager from '@/app/scheduling/_components/SchedulesManager';
import { FakeSchedulingApi } from '../../helpers/schedulingFakeApi';
import { expectNoAxeViolations } from '../../a11y/axe';

// The Schedules screen against the real API contract (tests/helpers/schedulingFakeApi.ts): list, preset picker, create, edit,
// archive, role-specific controls, and every way a write can be refused.

let api: FakeSchedulingApi;
beforeEach(() => {
  api = new FakeSchedulingApi();
  vi.stubGlobal('fetch', vi.fn(api.handler));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (canManage = true) => {
  const user = userEvent.setup();
  const view = render(<SchedulesManager canManage={canManage} />);
  return { user, view };
};

describe('schedules list', () => {
  it('lists active schedules with their type and links each name to its page', async () => {
    api.addSchedule({ name: 'Junior coaching' });
    api.addSchedule({ name: 'Clinic', presetKey: 'appointments' });
    api.addSchedule({ name: 'Old programme', archivedAt: '2026-01-01T00:00:00.000000Z' });
    await open();
    const table = await screen.findByRole('table', { name: 'Schedules' });
    expect(within(table).getByRole('link', { name: 'Junior coaching' })).toHaveAttribute('href', expect.stringMatching(/^\/scheduling\/schedules\/sch-\d+$/));
    expect(within(table).getByText('Classes and coaching')).toBeInTheDocument();
    expect(within(table).getByText('Appointments')).toBeInTheDocument();
    expect(within(table).queryByText('Old programme')).not.toBeInTheDocument(); // archived are behind the filter
  });

  it('shows archived schedules only when asked, without edit controls', async () => {
    api.addSchedule({ name: 'Old programme', archivedAt: '2026-01-01T00:00:00.000000Z' });
    api.addSchedule({ name: 'Live one' });
    const { user } = await open();
    await screen.findByRole('table', { name: 'Schedules' });
    await user.selectOptions(screen.getByLabelText('Status'), 'archived');
    const table = screen.getByRole('table', { name: 'Schedules' });
    expect(within(table).getByText('Old programme')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /Edit Old programme|Archive Old programme/ })).not.toBeInTheDocument();
  });

  it('an empty organisation is invited to create its first schedule; a viewer is only told there is none', async () => {
    const { view } = await open();
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create your first schedule|New schedule/ }).length).toBeGreaterThan(0);
    view.unmount();
    render(<SchedulesManager canManage={false} />);
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New schedule|Create your first schedule/ })).not.toBeInTheDocument();
  });

  it('a viewer sees the list with no way to change anything, and is told why', async () => {
    api.addSchedule();
    await open(false);
    await screen.findByRole('table', { name: 'Schedules' });
    expect(screen.getByRole('note')).toHaveTextContent('view-only');
    expect(screen.queryByRole('button', { name: /New schedule|Edit|Archive/ })).not.toBeInTheDocument();
  });

  it('a failed load says so and retries; a missing set-up and a denial are explained, not retried', async () => {
    api.schedules = [];
    const original = api.handler;
    let fail: 'network' | 'config' | 'denied' | null = 'network';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail === 'network') throw new TypeError('offline');
      if (fail === 'config') return Response.json({ error: 'x', code: 'SCHEDULING_NOT_CONFIGURED' }, { status: 503 });
      if (fail === 'denied') return Response.json({ error: 'Forbidden' }, { status: 403 });
      return original(input, init);
    }));
    const { user, view } = await open();
    expect(await screen.findByText('We couldn’t load this')).toBeInTheDocument();
    fail = null;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument();
    view.unmount();
    fail = 'config';
    render(<SchedulesManager canManage />);
    expect(await screen.findByText('Scheduling isn’t set up yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    cleanup();
    fail = 'denied';
    render(<SchedulesManager canManage />);
    expect(await screen.findByText('You can’t view this')).toBeInTheDocument();
  });
});

describe('create a schedule', () => {
  it('offers exactly the three initial presets, described by the shared core, and no other', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: /Create your first schedule/ }));
    const dialog = screen.getByRole('dialog');
    const group = within(dialog).getByRole('radiogroup', { name: 'Type of schedule' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByText('Classes and coaching')).toBeInTheDocument();
    expect(within(group).getByText('Appointments')).toBeInTheDocument();
    expect(within(group).getByText('Resource and facility hire')).toBeInTheDocument();
    for (const absent of [/restaurant/i, /accommodation/i, /event/i, /tennis/i]) expect(dialog).not.toHaveTextContent(absent);
  });

  it('posts the chosen type, name and the preset’s default cancellation policy, then shows the new schedule', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: /Create your first schedule/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), '  Physio clinic ');
    await user.click(within(dialog).getByRole('radio', { name: /Appointments/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = api.writes()[0];
    expect(post).toMatchObject({ method: 'POST', path: '/schedules' });
    expect(post.body).toMatchObject({ name: 'Physio clinic', presetKey: 'appointments', cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } } });
    expect(post.body).not.toHaveProperty('organisationId');
    expect(post.body).not.toHaveProperty('publicSlug');
    expect(await screen.findByRole('link', { name: 'Physio clinic' })).toBeInTheDocument();
  });

  it('refuses a blank name before calling the API', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: /Create your first schedule/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create schedule' }));
    expect(await screen.findByText('Give the schedule a name.')).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it('shows the API’s reasons when it refuses, and a network failure as "nothing was saved"', async () => {
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: /Create your first schedule/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'X');
    api.failNextWith = { status: 400, body: { error: 'The request is not valid.', code: 'INVALID_INPUT', problems: ['timezone must be a valid IANA timezone or null'] } };
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('timezone must be a valid IANA timezone or null')).toBeInTheDocument();
    api.offline = true;
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('Network error. Nothing was saved.')).toBeInTheDocument();
  });
});

describe('edit and archive', () => {
  it('sends only what changed, with the version token it read', async () => {
    const s = api.addSchedule({ name: 'Junior coaching' });
    const token = s.updatedAt;
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Edit Junior coaching' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Squad coaching');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: 'PATCH', path: `/schedules/${s.id}`, body: { expectedUpdatedAt: token, name: 'Squad coaching' } });
    expect(Object.keys(api.writes()[0].body ?? {}).sort()).toEqual(['expectedUpdatedAt', 'name']);
    expect(await screen.findByRole('link', { name: 'Squad coaching' })).toBeInTheDocument();
  });

  it('a stale write is explained, saves nothing, and offers to reload the latest', async () => {
    api.addSchedule({ name: 'Junior coaching' });
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Edit Junior coaching' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), ' 2');
    // somebody else saves first
    api.schedules[0].name = 'Renamed elsewhere';
    api.schedules[0].updatedAt = '2026-10-24T09:00:00.000001Z';
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/Someone else changed this while you were editing/)).toBeInTheDocument();
    expect(api.schedules[0].name).toBe('Renamed elsewhere'); // nothing of ours was written
    await user.click(within(dialog).getByRole('button', { name: 'Reload latest' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('link', { name: 'Renamed elsewhere' })).toBeInTheDocument();
  });

  it('archiving asks first, says what is kept, and posts once; a schedule archived meanwhile is reported', async () => {
    const s = api.addSchedule({ name: 'Junior coaching' });
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Archive Junior coaching' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Archiving cannot be undone');
    expect(dialog).toHaveTextContent('sessions');
    s.archivedAt = '2026-10-24T00:30:00.000000Z'; // archived by someone else while the dialog is open
    await user.click(within(dialog).getByRole('button', { name: 'Archive schedule' }));
    expect(await within(dialog).findByText(/archived and can no longer be changed/)).toBeInTheDocument();
    s.archivedAt = null;
    await user.click(within(dialog).getByRole('button', { name: 'Archive schedule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes().filter(w => w.path.endsWith('/archive'))).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Junior coaching' })).not.toBeInTheDocument());
  });
});

describe('accessibility', () => {
  it('the list and the open dialog have no detectable violations', async () => {
    api.addSchedule();
    const { user, view } = await open();
    await screen.findByRole('table', { name: 'Schedules' });
    await expectNoAxeViolations(view.container);
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    await expectNoAxeViolations(document.body);
  });
});
