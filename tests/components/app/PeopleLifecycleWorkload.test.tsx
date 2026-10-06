import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { default: LifecycleWorkloadPage } = await import('@/app/people/lifecycle/page');

const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKFLOW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HR-7H1 lifecycle workload overview', () => {
  it('shows only safe active workflow fields joined to safe person names', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);

      if (url === '/api/hr/people') {
        return response({
          canManage: true,
          people: [{
            id: PERSON_ID,
            first_name: 'Alex',
            last_name: 'Worker',
            work_email: 'sensitive@example.test',
            linked_user_id: 'sensitive-linked-user',
          }],
        });
      }

      if (url === '/api/hr/lifecycle/workflows?status=ACTIVE') {
        return response({
          capabilities: { can_start_workflow: true },
          workflows: [{
            id: WORKFLOW_ID,
            person_id: PERSON_ID,
            template_id: 'sensitive-template-id',
            lifecycle_type: 'onboarding',
            status: 'ACTIVE',
            anchor_date: '2026-10-01',
            started_by: 'sensitive-starter-id',
            started_at: '2026-10-01T01:02:03.000Z',
            completed_at: null,
            cancelled_at: null,
            capabilities: { can_cancel: true },
          }],
        });
      }

      return response({});
    });

    renderBrainbase(<LifecycleWorkloadPage />);

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    expect(screen.getByText('onboarding')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('2026-10-01')).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(PERSON_ID);
    expect(text).not.toContain(WORKFLOW_ID);
    expect(text).not.toContain('sensitive@example.test');
    expect(text).not.toContain('sensitive-linked-user');
    expect(text).not.toContain('sensitive-template-id');
    expect(text).not.toContain('sensitive-starter-id');
  });

  it('does not request organisation workload when the viewer is not an HR administrator', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);

      if (url === '/api/hr/people') {
        return response({
          canManage: false,
          people: [{
            id: PERSON_ID,
            first_name: 'Alex',
            last_name: 'Worker',
          }],
        });
      }

      return response({ error: 'workflow endpoint should not be called' }, 500);
    });

    renderBrainbase(<LifecycleWorkloadPage />);

    expect(await screen.findByText(
      'Lifecycle workload is available to HR administrators.',
    )).toBeTruthy();

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).startsWith('/api/hr/lifecycle/workflows')
    )).toBe(false);
  });

  it('shows an authorised empty state when there are no active workflows', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url === '/api/hr/people') {
        return response({
          canManage: true,
          people: [{
            id: PERSON_ID,
            first_name: 'Alex',
            last_name: 'Worker',
          }],
        });
      }
      if (url === '/api/hr/lifecycle/workflows?status=ACTIVE') {
        return response({ workflows: [] });
      }
      return response({});
    });

    renderBrainbase(<LifecycleWorkloadPage />);

    expect(await screen.findByText('No active lifecycle workflows.')).toBeTruthy();
  });

  it('shows only a generic error when workflow retrieval fails', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url === '/api/hr/people') {
        return response({
          canManage: true,
          people: [{
            id: PERSON_ID,
            first_name: 'Alex',
            last_name: 'Worker',
          }],
        });
      }
      if (url === '/api/hr/lifecycle/workflows?status=ACTIVE') {
        return response({ error: 'sensitive lifecycle database detail' }, 500);
      }
      return response({});
    });

    renderBrainbase(<LifecycleWorkloadPage />);

    expect(await screen.findByText('Could not load lifecycle workload.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive lifecycle database detail');
  });
});
