import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { CapabilityAccessError, CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}
function jsonRequest(body: unknown): NextRequest {
  return asNextRequest(new Request('http://localhost/api/hr/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return {
    ...actual,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
  };
});

const checkRateLimitMock = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}));

const loadAiSafeHrContextMock = vi.fn();
vi.mock('@/lib/hr/aiSafeContextLoader', () => ({
  loadAiSafeHrContext: (...args: unknown[]) => loadAiSafeHrContextMock(...args),
}));

const buildHrAiProviderInputMock = vi.fn();
vi.mock('@/lib/hr/aiProviderInput', () => ({
  HR_AI_MAX_QUESTION_CHARS: 2_000,
  buildHrAiProviderInput: (...args: unknown[]) => buildHrAiProviderInputMock(...args),
}));

const invokeHrAiProviderMock = vi.fn();
vi.mock('@/lib/agents/hrAiProviderAdapter', () => ({
  invokeHrAiProvider: (...args: unknown[]) => invokeHrAiProviderMock(...args),
}));

const { POST } = await import('@/app/api/hr/ai/route');

const SESSION = {
  userId: 'user-1',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'Viewer',
};

const SAFE_CONTEXT = {
  person: {
    display_name: 'Lex',
    job_title: 'Operations Coordinator',
    worker_type: 'employee',
    employment_status: 'active',
    team_name: 'Operations',
    manager_name: 'Morgan',
  },
  lifecycles: [],
};

beforeEach(() => {
  requireSessionMock.mockReset();
  checkRateLimitMock.mockReset();
  loadAiSafeHrContextMock.mockReset();
  buildHrAiProviderInputMock.mockReset();
  invokeHrAiProviderMock.mockReset();

  requireSessionMock.mockResolvedValue(SESSION);
  checkRateLimitMock.mockReturnValue(true);
  loadAiSafeHrContextMock.mockResolvedValue({
    outcome: 'ok',
    context: SAFE_CONTEXT,
  });
  buildHrAiProviderInputMock.mockReturnValue({
    system: 'safe-system',
    user: 'safe-user',
  });
  invokeHrAiProviderMock.mockResolvedValue({ text: 'Safe answer.' });
});

describe('HR-8G read-only HR AI route', () => {
  it.each([null, [], {}, { person_id: 'invalid', question: 'Hi' },
    { person_id: '11111111-1111-4111-8111-111111111111', question: 1 },
    { person_id: '11111111-1111-4111-8111-111111111111', question: 'x'.repeat(2001) },
  ])('rejects malformed request %j before loading context', async body => {
    const res = await POST(jsonRequest(body));
    expect(res.status).toBe(400);
    expect(loadAiSafeHrContextMock).not.toHaveBeenCalled();
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it.each(['{', JSON.stringify({ question: 'x'.repeat(16_385) })])('rejects invalid or oversized actual body bytes', async body => {
    const res = await POST(asNextRequest(new Request('http://localhost/api/hr/ai', { method: 'POST', body })));
    expect(res.status).toBe(400);
    expect(loadAiSafeHrContextMock).not.toHaveBeenCalled();
  });

  it('uses the trusted organisation and user as the rate-limit scope', async () => {
    await POST(jsonRequest({ person_id: '11111111-1111-4111-8111-111111111111', question: 'Hi' }));
    expect(checkRateLimitMock).toHaveBeenCalledWith('hr-ai:["org-a","user-1"]', 20, 3_600_000);
  });

  it.each([
    [new CapabilityAccessError('NO_ENTITLEMENT'), 404, 'HR record not found.'],
    [new CapabilityDatabaseError(), 503, 'HR assistant is temporarily unavailable.'],
    [new Error('database secret'), 502, 'HR assistant is temporarily unavailable.'],
  ])('fails closed on loader error without provider invocation', async (error, status, message) => {
    loadAiSafeHrContextMock.mockRejectedValue(error);
    const res = await POST(jsonRequest({ person_id: '11111111-1111-4111-8111-111111111111', question: 'Hi' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('does not cache successful answers', async () => {
    const res = await POST(jsonRequest({ person_id: '11111111-1111-4111-8111-111111111111', question: 'Hi' }));
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rejects unauthenticated requests before loading HR context', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'));

    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    }));

    expect(res.status).toBe(401);
    expect(loadAiSafeHrContextMock).not.toHaveBeenCalled();
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('rate-limits before reading HR context or invoking the provider', async () => {
    checkRateLimitMock.mockReturnValue(false);

    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(loadAiSafeHrContextMock).not.toHaveBeenCalled();
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('accepts only person_id and question in the request body', async () => {
    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
      raw_hr_row: { work_email: 'secret@example.com' },
    }));

    expect(res.status).toBe(400);
    expect(loadAiSafeHrContextMock).not.toHaveBeenCalled();
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('collapses invisible/missing HR people to generic 404 without invoking the provider', async () => {
    loadAiSafeHrContextMock.mockResolvedValue({ outcome: 'not_found' });

    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'HR record not found.' });
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('passes only loader-approved safe context into the HR-8E input builder', async () => {
    const body = {
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    };

    const res = await POST(jsonRequest(body));

    expect(res.status).toBe(200);
    expect(loadAiSafeHrContextMock).toHaveBeenCalledWith({
      session: SESSION,
      personId: body.person_id,
    });
    expect(buildHrAiProviderInputMock).toHaveBeenCalledWith({
      question: body.question,
      context: SAFE_CONTEXT,
    });
    expect(invokeHrAiProviderMock).toHaveBeenCalledWith({
      system: 'safe-system',
      user: 'safe-user',
    });
  });

  it('returns answer text only and never echoes safe context, person ID or provider metadata', async () => {
    invokeHrAiProviderMock.mockResolvedValue({
      text: 'The induction task is still in progress.',
      hypothetical_provider_metadata: 'must-not-escape',
    });

    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    }));
    const json = await res.json();

    expect(json).toEqual({
      answer: 'The induction task is still in progress.',
    });
    expect(JSON.stringify(json)).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(json)).not.toContain('Operations Coordinator');
    expect(JSON.stringify(json)).not.toContain('must-not-escape');
  });

  it('maps invalid questions to 400 without invoking the provider', async () => {
    buildHrAiProviderInputMock.mockImplementation(() => {
      throw new Error('HR AI question is required.');
    });

    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: '   ',
    }));

    expect(res.status).toBe(400);
    expect(invokeHrAiProviderMock).not.toHaveBeenCalled();
  });

  it('returns a generic 502 when the provider fails and does not expose provider error detail', async () => {
    invokeHrAiProviderMock.mockRejectedValue(new Error('provider secret detail'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(jsonRequest({
      person_id: '11111111-1111-4111-8111-111111111111',
      question: 'What is outstanding?',
    }));
    spy.mockRestore();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'HR assistant is temporarily unavailable.',
    });
  });
});
