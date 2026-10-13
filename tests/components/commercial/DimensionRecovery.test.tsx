import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DimensionSetup from '@/app/commercial/budgeting/setup/DimensionSetup';
const record = { id: 'record', code: 'GENERAL', name: 'General', description: null, active: true };
let records: typeof record[], failure: 'lost' | 'malformed' | 'server' | 'reject' | null, failRead: boolean;
let posts: string[], gate: Promise<void> | undefined;
const changed = vi.fn();
beforeEach(() => {
  records = []; failure = null; failRead = false; posts = []; gate = undefined; changed.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(url); if (gate) await gate;
      if (failure === 'reject') return Response.json({ error: 'Active Budget uses this record.' }, { status: 409 });
      records = [{ ...record, active: !url.endsWith('/deactivate') }];
      if (failure === 'lost') throw new Error('Response lost');
      if (failure === 'server') return Response.json({ error: 'Server failure' }, { status: 500 });
      return Response.json(failure === 'malformed' ? {} : { record: records[0] });
    }
    if (failRead) throw new Error('Read unavailable');
    return Response.json({ records });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const kinds = [ ['accounts', 'Budget accounts', 'Create account'], ['cost-centres', 'Cost centres', 'Create cost centre'] ] as const;
describe.each(kinds)('%s save recovery', (kind, title, create) => {
  async function mount() {
    render(<DimensionSetup kind={kind} title={title} onChange={changed} />);
    await waitFor(() => expect(screen.getByRole('button', { name: create })).toBeEnabled());
  }
  function fill() {
    fireEvent.change(screen.getByLabelText('Code', { exact: false }), { target: { value: 'GENERAL' } });
    fireEvent.change(screen.getByLabelText('Name', { exact: false }), { target: { value: 'General' } });
  }
  it.each(['lost', 'malformed', 'server'] as const)('recovers %s creation without resubmitting', async mode => {
    await mount(); fill(); failure = mode;
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: create })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form')); expect(posts).toHaveLength(1);
    failRead = true; fireEvent.click(screen.getByRole('button', { name: 'Reload ' + title.toLowerCase() }));
    await screen.findByText('Read unavailable');
    expect(screen.getByLabelText('Code', { exact: false })).toHaveValue('GENERAL');
    expect(screen.getByRole('button', { name: create })).toBeDisabled();
    failRead = false; fireEvent.click(screen.getByRole('button', { name: 'Reload ' + title.toLowerCase() }));
    await screen.findByText(/reloaded. Review/);
    expect(screen.getByRole('table')).toHaveTextContent('GENERAL');
    expect(screen.getByLabelText('Code', { exact: false })).toHaveValue('');
    expect(screen.getByRole('heading', { name: title })).toHaveFocus();
    expect(changed).toHaveBeenCalledTimes(1); expect(posts).toHaveLength(1);
  });
  it.each([true, false])('recovers status change from active=%s without repeating it', async active => {
    records = [{ ...record, active }]; await mount(); failure = 'lost'; fill();
    const action = active ? 'Deactivate GENERAL' : 'Reactivate GENERAL';
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: action })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload ' + title.toLowerCase() }));
    await screen.findByText(/reloaded. Review/);
    expect(screen.getByRole('button', { name: active ? 'Reactivate GENERAL' : 'Deactivate GENERAL' })).toBeEnabled();
    expect(posts).toHaveLength(1); expect(records[0].id).toBe('record');
  });
  it('locks create and status operations while a save is in flight', async () => {
    records = [record]; await mount(); fill();
    let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate GENERAL' }));
    fireEvent.submit(screen.getByRole('form'));
    expect(posts).toHaveLength(1); release();
    await screen.findByText(/GENERAL deactivated/);
    expect(screen.getByRole('button', { name: 'Reactivate GENERAL' })).toBeEnabled();
  });
  it('retains input and status when the server rejects a mutation', async () => {
    records = [record]; await mount(); fill(); failure = 'reject';
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate GENERAL' }));
    await screen.findByText('Active Budget uses this record.');
    expect(screen.getByRole('button', { name: 'Deactivate GENERAL' })).toBeEnabled();
    expect(screen.getByLabelText('Code', { exact: false })).toHaveValue('GENERAL');
    expect(within(screen.getByRole('table')).getByText('Active')).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
  });
  it('does not claim an empty list or allow creating after initial read failure', async () => {
    failRead = true; render(<DimensionSetup kind={kind} title={title} />);
    await screen.findByText('Read unavailable');
    expect(screen.queryByText('No records yet. Create the first record above.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: create })).toBeDisabled();
    failRead = false; fireEvent.click(screen.getByRole('button', { name: 'Reload ' + title.toLowerCase() }));
    await waitFor(() => expect(screen.getByRole('button', { name: create })).toBeEnabled());
  });
});
