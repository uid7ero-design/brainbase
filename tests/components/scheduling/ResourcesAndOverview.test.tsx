import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Overview from '@/app/scheduling/_components/Overview';
import ResourcesManager from '@/app/scheduling/_components/ResourcesManager';
import { FakeSchedulingApi } from '../../helpers/schedulingFakeApi';
import { expectNoAxeViolations } from '../../a11y/axe';

let api: FakeSchedulingApi;
beforeEach(() => {
  api = new FakeSchedulingApi();
  vi.stubGlobal('fetch', vi.fn(api.handler));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('resources', () => {
  const open = (canManage = true) => {
    const user = userEvent.setup();
    const view = render(<ResourcesManager canManage={canManage} />);
    return { user, view };
  };
  const table = () => screen.findByRole('table', { name: 'Resources' });

  it('lists active resources with a neutral type name, and inactive ones behind the filter', async () => {
    api.addResource({ name: 'Court 1', kind: 'court' });
    api.addResource({ name: 'Dr Chen', kind: 'practitioner' });
    api.addResource({ name: 'Old room', kind: 'room', active: false });
    const { user } = open();
    const t = await table();
    expect(within(t).getByText('Court')).toBeInTheDocument();
    expect(within(t).getByText('Practitioner')).toBeInTheDocument();
    expect(within(t).queryByText('Old room')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    expect(within(screen.getByRole('table', { name: 'Resources' })).getByText('Old room')).toBeInTheDocument();
  });

  it('offers only the types of the three initial presets (no restaurant table)', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: /Add your first resource/ }));
    const dialog = screen.getByRole('dialog');
    const types = within(within(dialog).getByLabelText(/^Type/)).getAllByRole('option').map(o => o.textContent);
    expect(types).toEqual(['Court', 'Space', 'Practitioner', 'Room', 'Online room', 'Equipment']);
  });

  it('creates a resource', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: /Add your first resource/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Studio A');
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), 'room');
    const cap = within(dialog).getByLabelText(/^Capacity/);
    await user.clear(cap);
    await user.type(cap, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Create resource' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.writes()[0]).toMatchObject({ method: 'POST', path: '/resources', body: { name: 'Studio A', kind: 'room', capacity: 12 } });
    expect(within(await table()).getByText('Studio A')).toBeInTheDocument();
  });

  it('refuses nonsense before calling the API', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: /Add your first resource/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'X');
    const cap = within(dialog).getByLabelText(/^Capacity/);
    await user.clear(cap);
    await user.type(cap, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Create resource' }));
    expect(await within(dialog).findByText(/Capacity must be a whole number of at least 1/)).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  it('deactivation is confirmed, explains its limit, and a resource held by a live reservation is refused with the reason', async () => {
    const r = api.addResource({ name: 'Court 1' });
    api.held.add(r.id);
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Deactivate Court 1' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('cannot be deactivated while a live reservation holds it');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByText(/in use by a live reservation or an assignment/)).toBeInTheDocument();
    expect(api.resources[0].active).toBe(true);
    api.held.clear();
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.resources[0].active).toBe(false);
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
    await user.click(await screen.findByRole('button', { name: 'Reactivate Court 1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(api.resources[0].active).toBe(true));
  });

  it('changing the type of an assigned resource is refused with the reason; a stale edit is explained', async () => {
    const r = api.addResource({ name: 'Court 1', kind: 'court' });
    const o = api.addOffering(api.addSchedule().id);
    api.link(o.id, r.id);
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Edit Court 1' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), 'space');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/in use by a live reservation or an assignment/)).toBeInTheDocument();
    expect(api.resources[0].kind).toBe('court');
    api.resources[0].updatedAt = '2026-10-24T09:00:00.000001Z';
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), 'court');
    const name = within(dialog).getByLabelText(/^Name/);
    await user.type(name, ' B');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/Someone else changed this/)).toBeInTheDocument();
  });

  it('a viewer sees resources but no controls', async () => {
    api.addResource();
    open(false);
    await table();
    expect(screen.getByRole('note')).toHaveTextContent('view-only');
    expect(screen.queryByRole('button', { name: /New resource|Edit|Deactivate|Reactivate/ })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, list or dialog', async () => {
    api.addResource();
    const { user, view } = open();
    await table();
    await expectNoAxeViolations(view.container);
    await user.click(screen.getByRole('button', { name: 'New resource' }));
    await expectNoAxeViolations(document.body);
  });
});

describe('overview', () => {
  const open = (canManage = true) => render(<Overview canManage={canManage} />);

  it('an empty organisation is walked through the first step', async () => {
    open();
    const steps = await screen.findByRole('list', { name: 'Set-up steps' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Create a schedule');
    expect(items[0]).toHaveTextContent('(to do)');
    expect(within(items[0]).getByRole('link', { name: 'Create a schedule' })).toHaveAttribute('href', '/scheduling/schedules');
  });

  it('shows which steps are done and what is missing, using the schedule’s own wording of the next step', async () => {
    const s = api.addSchedule({ presetKey: 'appointments', name: 'Clinic' });
    api.addOffering(s.id, { name: 'Consult', capacity: null });
    api.addResource({ kind: 'practitioner', name: 'Dr Chen' });
    open();
    const steps = await screen.findByRole('list', { name: 'Set-up steps' });
    const items = within(steps).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('(done)');
    expect(items[1]).toHaveTextContent('(done)');
    expect(items[2]).toHaveTextContent('(done)');
    expect(items[3]).toHaveTextContent('(to do)');
    expect(items[3]).toHaveTextContent('1 offering needs a resource: Consult');
    expect(within(items[3]).getByRole('link', { name: 'Open schedule' })).toHaveAttribute('href', `/scheduling/schedules/${s.id}`);
    expect(screen.getByText('Active schedules').closest('div')).toHaveTextContent('1');
  });

  it('is complete when every offering that needs a resource has one', async () => {
    const s = api.addSchedule({ presetKey: 'appointments' });
    const o = api.addOffering(s.id, { capacity: null });
    const r = api.addResource({ kind: 'practitioner' });
    api.link(o.id, r.id);
    open();
    const steps = await screen.findByRole('list', { name: 'Set-up steps' });
    for (const item of within(steps).getAllByRole('listitem')) expect(item).toHaveTextContent('(done)');
  });

  it('says plainly that taking reservations is not part of this release', async () => {
    open();
    expect(await screen.findByText(/Taking reservations is not part of this release/)).toBeInTheDocument();
  });

  it('a failed load is reported with a retry', async () => {
    api.offline = true;
    open();
    expect(await screen.findByText('We couldn’t load this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
