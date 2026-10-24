import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleDetail from '@/app/scheduling/_components/ScheduleDetail';
import { FakeSchedulingApi } from '../../helpers/schedulingFakeApi';
import { expectNoAxeViolations } from '../../a11y/axe';

// One schedule: preset-driven wording and fields, offering create/edit/archive, the preset lock, resource assignment, and the
// role-specific view. Everything runs against the real API contract (tests/helpers/schedulingFakeApi.ts).

let api: FakeSchedulingApi;
beforeEach(() => {
  api = new FakeSchedulingApi();
  vi.stubGlobal('fetch', vi.fn(api.handler));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (scheduleId: string, canManage = true) => {
  const user = userEvent.setup();
  const view = render(<ScheduleDetail scheduleId={scheduleId} canManage={canManage} />);
  return { user, view };
};

describe('preset-driven wording', () => {
  it.each([
    ['classes_coaching', 'Sessions', 'New session'],
    ['appointments', 'Services', 'New service'],
    ['resource_hire', 'Facilities', 'New facility'],
  ] as const)('%s speaks of %s, and never of any one sport or business', async (presetKey, plural, action) => {
    const s = api.addSchedule({ presetKey, name: 'Anything' });
    const { view } = open(s.id);
    expect(await screen.findByRole('heading', { name: plural })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: new RegExp(action, 'i') }).length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toMatch(/tennis|squad|coach(?!ing)|player|ld\b/i);
  });

  it('a schedule’s own terminology override wins over the preset', async () => {
    const s = api.addSchedule({ presetKey: 'appointments', terminology: { offering: 'Treatment', offeringPlural: 'Treatments' } });
    open(s.id);
    expect(await screen.findByRole('heading', { name: 'Treatments' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New treatment/i }).length).toBeGreaterThan(0);
  });
});

describe('offering fields follow the preset', () => {
  const dialogFor = async (presetKey: 'classes_coaching' | 'appointments' | 'resource_hire') => {
    const s = api.addSchedule({ presetKey });
    const ctx = open(s.id);
    await ctx.user.click((await screen.findAllByRole('button', { name: /^(Create the first|New) / }))[0]);
    return { ...ctx, s, dialog: screen.getByRole('dialog') };
  };

  it('classes ask for a headcount limit and a duration', async () => {
    const { dialog } = await dialogFor('classes_coaching');
    expect(within(dialog).getByLabelText(/Capacity/)).toBeInTheDocument();
    expect(within(dialog).getAllByText('Required').length).toBe(3); // name, duration, capacity
    expect(within(dialog).getByLabelText(/Price \(AUD\)/)).toBeInTheDocument();
  });

  it('appointments need a duration but no capacity (the resource decides)', async () => {
    const { dialog } = await dialogFor('appointments');
    expect(within(dialog).queryByLabelText(/Capacity/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Duration \(minutes\)/)).toBeInTheDocument();
  });

  it('hire lets the customer choose the duration, so it is optional, and has no capacity', async () => {
    const { dialog } = await dialogFor('resource_hire');
    expect(within(dialog).queryByLabelText(/Capacity/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Duration \(minutes, optional\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Leave blank to let the customer choose/)).toBeInTheDocument();
  });

  it('a series for appointments cannot repeat forever: that end mode is not offered', async () => {
    const { user, dialog } = await dialogFor('appointments');
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'weekly');
    const modes = within(within(dialog).getByLabelText('How it ends')).getAllByRole('option').map(o => o.textContent);
    expect(modes).toEqual(['Ends after a number of times', 'Ends on a date']);
  });

  it('classes may repeat forever', async () => {
    const { user, dialog } = await dialogFor('classes_coaching');
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'weekly');
    expect(within(within(dialog).getByLabelText('How it ends')).getAllByRole('option').map(o => o.textContent)).toContain('Keeps repeating');
  });
});

describe('offerings', () => {
  it('creates a class: dollars become cents, the currency comes from the organisation, and the list refreshes', async () => {
    const s = api.addSchedule();
    const { user } = open(s.id);
    await user.click((await screen.findAllByRole('button', { name: /Create the first session/ }))[0]);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Tuesday juniors');
    await user.type(within(dialog).getByLabelText(/Duration \(minutes\)/), '60');
    await user.type(within(dialog).getByLabelText(/Capacity/), '8');
    const price = within(dialog).getByLabelText(/Price \(AUD\)/);
    await user.clear(price);
    await user.type(price, '25.5');
    await user.click(within(dialog).getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: 'POST', path: `/schedules/${s.id}/offerings`, body: { name: 'Tuesday juniors', durationMinutes: 60, capacity: 8, priceCents: 2550, recurrence: { kind: 'none' } } });
    expect(api.writes()[0].body).not.toHaveProperty('currency');
    expect(within(await screen.findByRole('table', { name: 'Sessions' })).getByText('$25.50')).toBeInTheDocument();
  });

  it('applies the preset rules before calling the API (a class without a capacity is refused here, in plain words)', async () => {
    const s = api.addSchedule();
    const { user } = open(s.id);
    await user.click((await screen.findAllByRole('button', { name: /Create the first session/ }))[0]);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'No limit');
    await user.type(within(dialog).getByLabelText(/Duration \(minutes\)/), '45');
    await user.click(within(dialog).getByRole('button', { name: 'Create session' }));
    expect(await within(dialog).findByText(/need a capacity/)).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it('a weekly series builds the recurrence the API takes', async () => {
    const s = api.addSchedule({ presetKey: 'appointments' });
    const { user } = open(s.id);
    await user.click((await screen.findAllByRole('button', { name: /Create the first service/ }))[0]);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Check-up');
    await user.type(within(dialog).getByLabelText(/Duration \(minutes\)/), '30');
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'weekly');
    await user.selectOptions(within(dialog).getByLabelText('Day'), '3');
    await user.type(within(dialog).getByLabelText(/Start time/), '09:30');
    await user.type(within(dialog).getByLabelText('First date'), '2026-11-04');
    await user.type(within(dialog).getByLabelText('Number of times'), '6');
    await user.click(within(dialog).getByRole('button', { name: 'Create service' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0].body).toMatchObject({ startTime: '09:30', recurrence: { kind: 'weekly', dayOfWeek: 3, startDate: '2026-11-04', end: { mode: 'after_occurrences', count: 6 } } });
  });

  it('edits send only what changed, with the version token; a stale write is explained and nothing is saved', async () => {
    const s = api.addSchedule();
    const o = api.addOffering(s.id, { name: 'Tuesday juniors' });
    const token = o.updatedAt;
    const { user } = open(s.id);
    await user.click(await screen.findByRole('button', { name: 'Edit Tuesday juniors' }));
    const dialog = screen.getByRole('dialog');
    const cap = within(dialog).getByLabelText(/Capacity/);
    await user.clear(cap);
    await user.type(cap, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0].body).toEqual({ expectedUpdatedAt: token, capacity: 12 });

    await user.click(await screen.findByRole('button', { name: 'Edit Tuesday juniors' }));
    const again = screen.getByRole('dialog');
    const name = within(again).getByLabelText(/^Name/);
    await user.type(name, ' B');
    api.offerings[0].updatedAt = '2026-10-24T09:00:00.000001Z'; // someone else saved
    await user.click(within(again).getByRole('button', { name: 'Save changes' }));
    expect(await within(again).findByText(/Someone else changed this/)).toBeInTheDocument();
    expect(api.offerings[0].name).toBe('Tuesday juniors');
  });

  it('archiving an offering asks first and keeps reservations', async () => {
    const s = api.addSchedule();
    api.addOffering(s.id, { name: 'Tuesday juniors' });
    const { user } = open(s.id);
    await user.click(await screen.findByRole('button', { name: 'Archive Tuesday juniors' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Reservations already made are kept');
    await user.click(within(dialog).getByRole('button', { name: 'Archive session' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.offerings[0].archivedAt).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Tuesday juniors' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Show archived/ }));
    expect(within(screen.getByRole('table', { name: 'Sessions' })).getByText('Tuesday juniors')).toBeInTheDocument();
  });
});

describe('the schedule itself', () => {
  it('the type can be changed while there are no offerings', async () => {
    const s = api.addSchedule();
    const { user } = open(s.id);
    await user.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: /Appointments/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0].body).toMatchObject({ presetKey: 'appointments' });
    expect(await screen.findByRole('heading', { name: 'Services' })).toBeInTheDocument();
  });

  it('the type is locked, and says why, once there is an offering', async () => {
    const s = api.addSchedule();
    api.addOffering(s.id);
    const { user } = open(s.id);
    await user.click(await screen.findByRole('button', { name: 'Edit schedule' }));
    const dialog = screen.getByRole('dialog');
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(dialog).toHaveTextContent('cannot change once the schedule has offerings');
  });

  it('an archived schedule is read-only', async () => {
    const s = api.addSchedule({ archivedAt: '2026-01-01T00:00:00.000000Z' });
    api.addOffering(s.id);
    open(s.id);
    await screen.findByText(/This schedule is archived/);
    expect(screen.queryByRole('button', { name: /Edit schedule|New session|Archive/ })).not.toBeInTheDocument();
  });

  it('a schedule that does not exist (or is another organisation’s) is a plain not-found, with a way back', async () => {
    open('missing');
    expect(await screen.findByText('We couldn’t load this')).toBeInTheDocument();
    expect(screen.getByText(/no longer exists, or you do not have access/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to schedules' })).toHaveAttribute('href', '/scheduling/schedules');
  });
});

describe('assigning resources', () => {
  const setup = (presetKey: 'classes_coaching' | 'appointments' = 'appointments', canManage = true) => {
    const s = api.addSchedule({ presetKey, name: 'Clinic' });
    const o = api.addOffering(s.id, { name: 'Consult', capacity: null });
    const dr = api.addResource({ kind: 'practitioner', name: 'Dr Chen', capacity: 1 });
    api.addResource({ kind: 'court', name: 'Centre court', capacity: 4 }); // not an appointments resource
    api.addResource({ kind: 'room', name: 'Retired room', capacity: 2, active: false });
    api.addResource({ kind: 'room', name: 'Room 2', capacity: 2 });
    return { s, o, dr, ...open(s.id, canManage) };
  };

  it('offers only active resources of a type the schedule accepts, and assigns one', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: /Assign providers for Consult/ }));
    const dialog = screen.getByRole('dialog');
    const select = await within(dialog).findByLabelText(/Add a provider/);
    const options = within(select).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Choose…', 'Dr Chen (Practitioner)', 'Room 2 (Room)']);
    await user.selectOptions(select, options[1]!);
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByRole('list', { name: /Assigned providers/ })).toHaveTextContent('Dr Chen');
    expect(api.writes()[0]).toMatchObject({ method: 'POST', body: { resourceId: expect.stringMatching(/^res-/) } });
  });

  it('removing an assignment keeps the resource; a live reservation blocks it and the reason is shown', async () => {
    const { user, dr, o } = setup();
    api.link(o.id, dr.id);
    await user.click(await screen.findByRole('button', { name: /Assign providers for Consult/ }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('list', { name: /Assigned providers/ });
    api.held.add(dr.id);
    await user.click(within(dialog).getByRole('button', { name: 'Remove Dr Chen' }));
    expect(await within(dialog).findByText(/live reservation is holding this resource/)).toBeInTheDocument();
    expect(api.links).toHaveLength(1);
    api.held.clear();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Dr Chen' }));
    await waitFor(() => expect(api.links).toHaveLength(0));
    expect(api.resources.some(r => r.id === dr.id)).toBe(true);
  });

  it('a viewer can see what is assigned but cannot change it', async () => {
    const { user, dr, o } = setup('appointments', false);
    api.link(o.id, dr.id);
    await user.click(await screen.findByRole('button', { name: /View providers for Consult/ }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('list', { name: /Assigned providers/ })).toHaveTextContent('Dr Chen');
    expect(within(dialog).queryByRole('button', { name: /Remove|^Add$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New service|Edit|Archive/ })).not.toBeInTheDocument();
  });

  it('says when nothing suitable exists to assign', async () => {
    const s = api.addSchedule({ presetKey: 'appointments' });
    api.addOffering(s.id, { name: 'Consult', capacity: null });
    api.addResource({ kind: 'court', name: 'Centre court' });
    const { user } = open(s.id);
    await user.click(await screen.findByRole('button', { name: /Assign providers for Consult/ }));
    expect(await screen.findByText(/No other active providers of an accepted type/)).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('the detail page and its dialogs have no detectable violations', async () => {
    const s = api.addSchedule();
    api.addOffering(s.id);
    const { user, view } = open(s.id);
    await screen.findByRole('table', { name: 'Sessions' });
    await expectNoAxeViolations(view.container);
    await user.click(screen.getByRole('button', { name: 'Edit Tuesday juniors' }));
    await expectNoAxeViolations(document.body);
  });
});
