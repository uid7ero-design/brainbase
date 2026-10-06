import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

const fetchMock = vi.fn();
const { default: LifecycleTemplatesPage } = await import('@/app/people/lifecycle-templates/page');

const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function template(status: 'DRAFT' | 'ACTIVE' | 'RETIRED', capabilities: {
  can_create_version: boolean;
  can_activate: boolean;
  can_retire: boolean;
}, overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    template_key: 'standard-onboarding',
    version_number: 1,
    lifecycle_type: 'onboarding',
    name: 'Standard onboarding',
    description: null,
    status,
    activated_at: status === 'ACTIVE' ? '2026-10-06T09:00:00.000Z' : null,
    retired_at: status === 'RETIRED' ? '2026-10-06T10:00:00.000Z' : null,
    created_by: 'sensitive-creator-id',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    capabilities,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HR-7G2B lifecycle template status actions', () => {
  it('hides activate and retire when the server capabilities do not permit them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates') {
        return response({
          capabilities: { can_create_template: true },
          templates: [template('DRAFT', {
            can_create_version: true,
            can_activate: false,
            can_retire: false,
          })],
        });
      }
      if (url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID) {
        return response({ template: { tasks: [] } });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Standard onboarding' }));
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(document.body.textContent).not.toContain('sensitive-creator-id');
  });

  it('requires confirmation, activates, and refreshes server-derived status capabilities', async () => {
    let listReads = 0;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates') {
        listReads += 1;
        return response({
          capabilities: { can_create_template: true },
          templates: [listReads === 1
            ? template('DRAFT', {
              can_create_version: true,
              can_activate: true,
              can_retire: true,
            })
            : template('ACTIVE', {
              can_create_version: true,
              can_activate: false,
              can_retire: true,
            })],
        });
      }
      if (url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID) {
        return response({ template: { tasks: [] } });
      }
      if (
        url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID + '/activate'
        && init?.method === 'POST'
      ) {
        return response({
          template: {
            id: TEMPLATE_ID,
            status: 'ACTIVE',
            created_by: 'sensitive-activation-actor',
          },
        });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Standard onboarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(screen.getByText('Activate this template version?')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/activate') && init?.method === 'POST'
    )).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm activate' }));

    expect(await screen.findByText('onboarding · v1 · ACTIVE')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    expect(listReads).toBe(2);
    expect(document.body.textContent).not.toContain('sensitive-activation-actor');
  });

  it('requires confirmation, retires, and refreshes the template to a terminal status', async () => {
    let listReads = 0;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates') {
        listReads += 1;
        return response({
          capabilities: { can_create_template: true },
          templates: [listReads === 1
            ? template('ACTIVE', {
              can_create_version: true,
              can_activate: false,
              can_retire: true,
            })
            : template('RETIRED', {
              can_create_version: true,
              can_activate: false,
              can_retire: false,
            })],
        });
      }
      if (url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID) {
        return response({ template: { tasks: [] } });
      }
      if (
        url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID + '/retire'
        && init?.method === 'POST'
      ) {
        return response({
          template: {
            id: TEMPLATE_ID,
            status: 'RETIRED',
            created_by: 'sensitive-retirement-actor',
          },
        });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Standard onboarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));

    expect(screen.getByText('Retire this template version?')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/retire') && init?.method === 'POST'
    )).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm retire' }));

    expect(await screen.findByText('onboarding · v1 · RETIRED')).toBeTruthy();
    expect(screen.getByText('Retired 2026-10-06')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(listReads).toBe(2);
    expect(document.body.textContent).not.toContain('sensitive-retirement-actor');
  });

  it('shows only a generic status-action failure and preserves the current template state', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates') {
        return response({
          capabilities: { can_create_template: true },
          templates: [template('DRAFT', {
            can_create_version: true,
            can_activate: true,
            can_retire: true,
          })],
        });
      }
      if (url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID) {
        return response({ template: { tasks: [] } });
      }
      if (
        url === '/api/hr/lifecycle/templates/' + TEMPLATE_ID + '/activate'
        && init?.method === 'POST'
      ) {
        return response({ error: 'sensitive activation database detail' }, 500);
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Standard onboarding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm activate' }));

    expect(await screen.findByText('Could not update lifecycle template.')).toBeTruthy();
    expect(screen.getByText('onboarding · v1 · DRAFT')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive activation database detail');
  });
});
