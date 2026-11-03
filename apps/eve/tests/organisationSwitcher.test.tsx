import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrganisationSwitcher } from '@/components/organiser/SessionControls';

afterEach(() => vi.unstubAllGlobals());
describe('Organisation switcher on demand', () => {
  it('does not fetch on page render; loads the available choices on request', async () => {
    const fetch = vi.fn(async () => Response.json({ organisations: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }));
    vi.stubGlobal('fetch', fetch);
    render(<OrganisationSwitcher currentId="one" />);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Switch organisation' }));
    expect(await screen.findByRole('combobox', { name: 'Organisation' })).toHaveValue('one');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/organisation');
    expect(screen.getByRole('option', { name: 'Two' })).toBeInTheDocument();
  });
  it('shows a recoverable error rather than silently hiding a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })));
    render(<OrganisationSwitcher currentId="one" />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch organisation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load organisations');
    expect(screen.getByRole('button', { name: 'Switch organisation' })).toBeEnabled();
  });
  it('recovers if the organisation switch request cannot reach the server', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ organisations: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] })).mockRejectedValueOnce(new Error('Network unavailable'));
    vi.stubGlobal('fetch', fetch);
    render(<OrganisationSwitcher currentId="one" />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch organisation' }));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'two');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch organisation');
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ organisationId: 'two' }) });
  });
});
