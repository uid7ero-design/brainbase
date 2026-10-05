import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { default: PersonDrawer } = await import('@/app/people/_components/PersonDrawer');

const PERSON = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  first_name: 'Alex',
  last_name: 'Worker',
  preferred_name: null,
  work_email: 'alex@example.test',
  work_phone: null,
  job_title: 'Operator',
  worker_type: 'employee',
  employment_status: 'active',
  team_id: null,
  manager_person_id: null,
  start_date: '2026-01-01',
  end_date: null,
  linked_user_id: 'user-a',
  team_name: null,
  manager_first_name: null,
  manager_last_name: null,
};

const DOCUMENT = {
  id: 'doc-1',
  document_type: 'policy',
  title: 'Safety policy',
  lifecycle_task_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  current_version: {
    id: 'version-2',
    version_number: 2,
    expires_at: '2027-10-01',
    created_at: '2026-10-02T00:00:00.000Z',
  },
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function assuranceResponse(overrides: Record<string, unknown> = {}) {
  return response({
    assurance: {
      document_version_id: 'version-2',
      capabilities: {
        can_acknowledge: false,
        can_verify: false,
      },
      employee_acknowledgement: {
        acknowledged: true,
        acknowledged_at: '2026-10-03T01:02:03.000Z',
      },
      latest_verification: {
        decision: 'VERIFIED',
        verified_at: '2026-10-03T02:03:04.000Z',
      },
      ...overrides,
    },
  });
}

function renderDrawer() {
  return renderBrainbase(
    <PersonDrawer
      personId={PERSON.id}
      canManage={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HR-7E6C/6D PersonDrawer employee documents', () => {
  it('shows safe document metadata and current-version assurance status', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('Safety policy')).toBeTruthy();
    expect(screen.getByText('policy · Version 2')).toBeTruthy();
    expect(screen.getByText('Expires 2027-10-01')).toBeTruthy();
    expect(await screen.findByText('Acknowledged 2026-10-03')).toBeTruthy();
    expect(screen.getByText('Verified 2026-10-03')).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('version-2');
    expect(text).not.toContain('storage');
    expect(text).not.toContain('filename');
    expect(text).not.toContain('uploaded');
    expect(text).not.toContain('verified_by');
    expect(text).not.toContain('comment');
  });

  it('lets the linked employee acknowledge when the assurance capability permits it', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/acknowledgements') && init?.method === 'POST') {
        return response({
          acknowledgement: {
            id: 'ack-1',
            document_version_id: 'version-2',
            acknowledged_by: 'user-a',
            acknowledged_at: '2026-10-05T04:05:06.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    const button = await screen.findByRole('button', { name: 'Acknowledge' });
    fireEvent.click(button);

    expect(await screen.findByText('Acknowledged 2026-10-05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/acknowledgements`,
      { method: 'POST' },
    );
  });

  it('keeps document details visible and shows only a generic acknowledgement failure', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
        });
      }
      if (url.endsWith('/acknowledgements') && init?.method === 'POST') {
        return response({ error: 'sensitive mutation detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));

    expect(await screen.findByText('Could not acknowledge document.')).toBeTruthy();
    expect(screen.getByText('Safety policy')).toBeTruthy();
    expect(screen.getByText('Not acknowledged')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive mutation detail');
  });

  it('does not show acknowledgement controls when the server capability denies them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Not acknowledged')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('lets an HR administrator verify when the assurance capability permits it', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({
          verification: {
            id: 'verification-1',
            document_version_id: 'version-2',
            verified_by: 'hr-user',
            decision: 'VERIFIED',
            comment: 'server-only detail',
            verified_at: '2026-10-05T05:06:07.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Verified 2026-10-05')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/verifications`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      },
    );
    expect(document.body.textContent).not.toContain('hr-user');
    expect(document.body.textContent).not.toContain('server-only detail');
  });

  it('lets an HR administrator reject and updates the latest verification status', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({
          verification: {
            id: 'verification-2',
            document_version_id: 'version-2',
            verified_by: 'hr-user',
            decision: 'REJECTED',
            comment: null,
            verified_at: '2026-10-05T06:07:08.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Rejected 2026-10-05')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/verifications`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED' }),
      }),
    );
  });

  it('does not show verification controls when the server capability denies them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Verified 2026-10-03')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('shows only a generic verification failure and preserves current status', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({ error: 'sensitive verification detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Could not record verification.')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive verification detail');
  });

  it('shows explicit not-acknowledged and not-verified states', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
          latest_verification: null,
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Not acknowledged')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
  });

  it('shows a rejected latest verification without exposing verifier identity or comments', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          latest_verification: {
            decision: 'REJECTED',
            verified_at: '2026-10-04T05:06:07.000Z',
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Rejected 2026-10-04')).toBeTruthy();
    expect(document.body.textContent).not.toContain('comment');
    expect(document.body.textContent).not.toContain('verified_by');
  });

  it('keeps document metadata visible when assurance status cannot be loaded', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return response({ error: 'sensitive assurance detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Safety policy')).toBeTruthy();
    expect(await screen.findByText('Assurance status unavailable.')).toBeTruthy();
    expect(screen.queryByText('sensitive assurance detail')).toBeNull();
  });

  it('shows an authorised empty state when the documents API returns an empty list', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [] });
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('No documents')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/assurance'))).toBe(false);
  });

  it('hides the entire Documents section when the documents API returns 404', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({ error: 'Employee document not found.' }, 404);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Loading documents…')).toBeNull();
    });
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.queryByText('No documents')).toBeNull();
    expect(screen.queryByText(/Employee document not found/i)).toBeNull();
  });

  it('shows a generic inline error for an authorised documents fetch failure', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({ error: 'sensitive database detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('Could not load documents.')).toBeTruthy();
    expect(screen.queryByText('sensitive database detail')).toBeNull();
  });

  it('does not let a document-list failure prevent the person profile from rendering', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return Promise.reject(new Error('network down'));
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    expect(await screen.findByText('Could not load documents.')).toBeTruthy();
  });
});
