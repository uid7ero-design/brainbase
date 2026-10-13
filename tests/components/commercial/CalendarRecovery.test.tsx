import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarSetup from '@/app/commercial/budgeting/setup/CalendarSetup';
const year = { id: 'year', name: 'FY', starts_on: '2027-07-01', ends_on: '2028-06-30', status: 'OPEN', periods: [] as { id: string; name: string; starts_on: string; ends_on: string; status: string }[] };
let years: typeof year[];
let lost: boolean, malformed: boolean, failRead: boolean, reject: boolean;
let gate: Promise<void> | undefined;
let posts: number;
const changed = vi.fn();
beforeEach(() => {
  years = []; lost = false; malformed = false; failRead = false; reject = false; gate = undefined; posts = 0; changed.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts++; if (gate) await gate;
      if (reject) return Response.json({ error: 'Overlapping year.' }, { status: 409 });
      const period = { id: 'period', name: 'July', starts_on: '2027-07-01', ends_on: '2027-07-31', status: 'OPEN' };
      const isPeriodSave = url.endsWith('/periods');
      years = [{ ...year, periods: isPeriodSave ? [period] : [] }];
      if (lost) throw new Error('Connection lost');
      return Response.json(malformed ? {} : isPeriodSave ? { period } : { year });
    }
    if (failRead) throw new Error('Read unavailable');
    return Response.json({ years });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fill() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create year' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Year name', { exact: false }), { target: { value: 'FY' } });
  fireEvent.change(screen.getByLabelText('Year start date', { exact: false }), { target: { value: '01/07/2027' } });
  fireEvent.change(screen.getByLabelText('Year end date', { exact: false }), { target: { value: '30/06/2028' } });
}
describe('Financial calendar save recovery', () => {
  it.each(['lost', 'malformed'])('reloads persisted %s responses without resubmitting', async failure => {
    render(<CalendarSetup onChange={changed} />); await fill();
    lost = failure === 'lost'; malformed = failure === 'malformed';
    fireEvent.submit(screen.getByRole('form', { name: 'Create financial year' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Create year' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Create financial year' }));
    expect(posts).toBe(1);
    failRead = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reload financial calendar' }));
    await screen.findByText('Read unavailable');
    expect(screen.getByLabelText('Year name', { exact: false })).toHaveValue('FY');
    expect(screen.getByRole('button', { name: 'Create year' })).toBeDisabled();
    failRead = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload financial calendar' }));
    await screen.findByText(/Financial calendar reloaded/);
    expect(screen.getByLabelText('Financial year')).toHaveValue('year');
    expect(screen.getByLabelText('Year name', { exact: false })).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Financial periods' })).toHaveFocus();
    expect(changed).toHaveBeenCalledTimes(1); expect(posts).toBe(1);
  });
  it('recovers a persisted period without posting it again', async () => {
    years = [{ ...year, periods: [] }]; render(<CalendarSetup onChange={changed} />);
    await screen.findByRole('button', { name: 'Create period' });
    fireEvent.change(screen.getByLabelText('Period name', { exact: false }), { target: { value: 'July' } });
    fireEvent.change(screen.getByLabelText('Period start date', { exact: false }), { target: { value: '01/07/2027' } });
    fireEvent.change(screen.getByLabelText('Period end date', { exact: false }), { target: { value: '31/07/2027' } });
    lost = true; fireEvent.submit(screen.getByRole('form', { name: 'Create financial period' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Create period' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Create financial period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload financial calendar' }));
    await screen.findByText('31/07/2027');
    expect(screen.getByLabelText('Period name', { exact: false })).toHaveValue('');
    expect(posts).toBe(1); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('locks synchronous duplicate submits until the first save finishes', async () => {
    render(<CalendarSetup />); await fill();
    let release!: () => void;
    gate = new Promise<void>(resolve => { release = resolve; });
    const form = screen.getByRole('form', { name: 'Create financial year' });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(posts).toBe(1); release();
    await screen.findByText('Financial year created. Add its periods below.');
    expect(screen.getByLabelText('Financial year')).toHaveValue('year');
  });
  it('retains rejected entries and allows correction', async () => {
    render(<CalendarSetup />); await fill(); reject = true;
    fireEvent.submit(screen.getByRole('form', { name: 'Create financial year' }));
    await screen.findByText('Overlapping year.');
    expect(screen.getByLabelText('Year name', { exact: false })).toHaveValue('FY');
    expect(screen.getByRole('button', { name: 'Create year' })).toBeEnabled();
  });
  it('requires a successful read before creating after initial load failure', async () => {
    failRead = true; render(<CalendarSetup />);
    await screen.findByText('Read unavailable');
    expect(screen.queryByText('No financial years yet. Create your first year above.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create year' })).toBeDisabled();
    failRead = false; fireEvent.click(screen.getByRole('button', { name: 'Reload financial calendar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create year' })).toBeEnabled());
  });
  it('keeps closed-year period creation unavailable after reload', async () => {
    years = [{ ...year, status: 'CLOSED' }]; render(<CalendarSetup />);
    await screen.findByRole('option', { name: 'FY · CLOSED' });
    fireEvent.change(screen.getByLabelText('Financial year'), { target: { value: 'year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload financial calendar' }));
    await screen.findByText(/Financial calendar reloaded/);
    expect(screen.queryByRole('button', { name: 'Create period' })).not.toBeInTheDocument();
    expect(screen.getByText(/This year is closed/)).toBeVisible();
  });
});
