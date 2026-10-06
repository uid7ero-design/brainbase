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

describe('HR-7G3A lifecycle template creation', () => {
  it('hides template creation when the server collection capability is false', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates') {
        return response({
          capabilities: { can_create_template: false },
          templates: [],
        });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    expect(await screen.findByText('No lifecycle templates yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Create Template' })).toBeNull();
  });

  it('creates a template with ordered task definitions and refreshes the list', async () => {
    let listReads = 0;

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates' && init?.method === 'POST') {
        return response({
          template: {
            id: TEMPLATE_ID,
            status: 'DRAFT',
            created_by: 'sensitive-template-creator',
          },
        }, 201);
      }
      if (url === '/api/hr/lifecycle/templates') {
        listReads += 1;
        return response({
          capabilities: { can_create_template: true },
          templates: listReads === 1 ? [] : [template('DRAFT', {
            can_create_version: true,
            can_activate: true,
            can_retire: true,
          }, {
            lifecycle_type: 'offboarding',
            name: 'Exit process',
            template_key: 'exit-process',
          })],
        });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Create Template' }));

    fireEvent.change(await screen.findByLabelText(/Template key/i), {
      target: { value: 'exit-process' },
    });
    fireEvent.change(screen.getByLabelText(/Lifecycle type/i), {
      target: { value: 'offboarding' },
    });
    fireEvent.change(screen.getByLabelText(/^Name/i), {
      target: { value: 'Exit process' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Standard employee exit process' },
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));

    const titles = screen.getAllByLabelText(/Task title/i);
    const descriptions = screen.getAllByLabelText('Task description');
    const responsibilities = screen.getAllByLabelText(/Responsibility/i);
    const dueOffsets = screen.getAllByLabelText('Due offset days');
    const approvals = screen.getAllByLabelText('Requires approval');
    const employeeVisibility = screen.getAllByLabelText('Employee visible');
    const managerVisibility = screen.getAllByLabelText('Manager visible');
    const internalOnly = screen.getAllByLabelText('Internal only');

    fireEvent.change(titles[0], { target: { value: 'Manager handover' } });
    fireEvent.change(descriptions[0], { target: { value: 'Confirm handover' } });
    fireEvent.change(responsibilities[0], { target: { value: 'MANAGER' } });
    fireEvent.change(dueOffsets[0], { target: { value: '-2' } });
    fireEvent.click(approvals[0]);
    fireEvent.change(screen.getByLabelText(/Approval type/i), {
      target: { value: 'HR_ADMIN' },
    });
    fireEvent.click(employeeVisibility[0]);
    fireEvent.click(managerVisibility[0]);

    fireEvent.change(titles[1], { target: { value: 'Close access' } });
    fireEvent.click(internalOnly[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));

    expect(await screen.findByText('Exit process')).toBeTruthy();

    const createCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === '/api/hr/lifecycle/templates' && init?.method === 'POST'
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      template_key: 'exit-process',
      lifecycle_type: 'offboarding',
      name: 'Exit process',
      description: 'Standard employee exit process',
      tasks: [
        {
          sequence: 1,
          title: 'Manager handover',
          description: 'Confirm handover',
          responsibility_type: 'MANAGER',
          due_offset_days: -2,
          requires_approval: true,
          approval_type: 'HR_ADMIN',
          employee_visible: false,
          manager_visible: true,
          internal_only: false,
        },
        {
          sequence: 2,
          title: 'Close access',
          description: null,
          responsibility_type: 'EMPLOYEE',
          due_offset_days: null,
          requires_approval: false,
          approval_type: 'NONE',
          employee_visible: false,
          manager_visible: false,
          internal_only: true,
        },
      ],
    });
    expect(listReads).toBe(2);
    expect(document.body.textContent).not.toContain('sensitive-template-creator');
  });

  it('shows only a generic create failure and leaves the builder available', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/hr/lifecycle/templates' && init?.method === 'POST') {
        return response({ error: 'sensitive template family conflict detail' }, 409);
      }
      if (url === '/api/hr/lifecycle/templates') {
        return response({
          capabilities: { can_create_template: true },
          templates: [],
        });
      }
      return response({});
    });

    renderBrainbase(<LifecycleTemplatesPage />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Create Template' }));
    fireEvent.change(await screen.findByLabelText(/Template key/i), {
      target: { value: 'standard-onboarding' },
    });
    fireEvent.change(screen.getByLabelText(/^Name/i), {
      target: { value: 'Standard onboarding' },
    });
    fireEvent.change(screen.getByLabelText(/Task title/i), {
      target: { value: 'Complete profile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));

    expect(await screen.findByText('Could not create lifecycle template.')).toBeTruthy();
    expect(screen.getByLabelText(/Template key/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive template family conflict detail');
  });
});

