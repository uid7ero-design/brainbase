import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import RequestDemoPage from '@/app/request-demo/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectAssertiveLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';

// The request contract is unchanged from the pre-redesign page:
// POST /api/request-demo, JSON body = the whole form state in this key order.
const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  business_name: '',
  business_type: '',
  description: '',
  num_clients: '',
  num_users: '',
  goal: '',
  referral: '',
};

function mockFetch(response: { ok: boolean; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}), ...response });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillRequired(user: ReturnType<typeof renderBrainbase>['user']) {
  await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Jane Smith');
  await user.type(screen.getByRole('textbox', { name: /Work email/ }), 'jane@example.com.au');
  await user.type(screen.getByRole('textbox', { name: /Organisation \/ Business name/ }), 'Acme Tennis');
}

describe('/request-demo', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<RequestDemoPage />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has exactly one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<RequestDemoPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Tell us what you're trying to improve.");
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('gives every form control a visible, associated label', () => {
    renderBrainbase(<RequestDemoPage />);
    const form = screen.getByRole('form', { name: 'Demo request' });
    const controls = form.querySelectorAll('input, select, textarea');
    expect(controls).toHaveLength(10);
    controls.forEach(control => {
      const label = form.querySelector(`label[for="${control.id}"]`);
      expect(label, `label for #${control.id}`).not.toBeNull();
      expect(control).toHaveAccessibleName(expect.stringContaining(label!.querySelector('span')!.textContent!));
    });
  });

  it('names required fields in text (not colour) and marks them aria-required', () => {
    renderBrainbase(<RequestDemoPage />);
    for (const name of [/Full name/, /Work email/, /Organisation \/ Business name/]) {
      const field = screen.getByRole('textbox', { name });
      expect(field).toHaveAccessibleName(expect.stringContaining('Required'));
      expect(field).toHaveAttribute('aria-required', 'true');
      // Not the native attribute — the page's own validation message is kept.
      expect(field).not.toHaveAttribute('required');
    }
    expect(screen.getByRole('textbox', { name: 'Phone' })).not.toHaveAttribute('aria-required');
  });

  it('associates helper text with its control', () => {
    renderBrainbase(<RequestDemoPage />);
    expect(screen.getByRole('textbox', { name: 'Tell us about your operation' })).toHaveAccessibleDescription(
      'A few sentences is enough. Include any systems or tools you currently rely on, if relevant.',
    );
  });

  it('submits from the keyboard with the same endpoint and payload as before', async () => {
    const fetchMock = mockFetch({ ok: true });
    const { user } = renderBrainbase(<RequestDemoPage />);
    await fillRequired(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Organisation type' }), 'Consulting');
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '0400 000 000{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/request-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...EMPTY_FORM,
        name: 'Jane Smith',
        email: 'jane@example.com.au',
        phone: '0400 000 000',
        business_name: 'Acme Tennis',
        business_type: 'Consulting',
      }),
    });
  });

  it('announces the validation message politely (not as an interrupting alert), shows it clearly, flags the empty required fields, and sends nothing', async () => {
    const fetchMock = mockFetch({ ok: true });
    const { user } = renderBrainbase(<RequestDemoPage />);
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Jane{Enter}');

    // Visible, labelled error box — but not role="alert".
    const box = await screen.findByRole('group', { name: "Your request wasn't sent" });
    expect(box).toHaveTextContent('Name, email and organisation name are required.');
    expect(box).toHaveAttribute('data-state', 'error');
    expect(screen.queryByRole('alert')).toBeNull();

    // Announced through the persistent polite live region.
    const status = screen.getByRole('status');
    expectPoliteLiveRegion(status);
    expect(status).toHaveTextContent("Your request wasn't sent. Name, email and organisation name are required.");
    expect(fetchMock).not.toHaveBeenCalled();

    const email = screen.getByRole('textbox', { name: /Work email/ });
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Name, email and organisation name are required.');
    expect(screen.getByRole('textbox', { name: /Full name/ })).not.toHaveAttribute('aria-invalid');
  });

  it('shows the server error message when the request fails', async () => {
    mockFetch({ ok: false, json: async () => ({ error: 'Rate limited — try again shortly.' }) });
    const { user } = renderBrainbase(<RequestDemoPage />);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Discuss my operation' }));

    // A failed send is the one genuinely critical state: it keeps role="alert".
    const alert = await screen.findByRole('alert');
    expectAssertiveLiveRegion(alert);
    expect(alert).toHaveTextContent('Rate limited — try again shortly.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Tell us what you're trying to improve.");
  });

  it('announces sending politely, then confirms receipt and moves focus to the confirmation', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => (resolve = r))));
    const { user, container } = renderBrainbase(<RequestDemoPage />);
    const status = screen.getByRole('status');
    expectPoliteLiveRegion(status);
    expect(status).toHaveTextContent('');

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Discuss my operation' }));
    expect(status).toHaveTextContent('Sending your request');
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();

    resolve({ ok: true, json: async () => ({}) });
    const heading = await screen.findByRole('heading', { level: 1, name: "Thanks — we've received your request." });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Request received');

    expect(screen.getByRole('link', { name: 'Explore the platform' })).toHaveAttribute('href', '/demo');
    expect(screen.getByRole('link', { name: 'Back to BrainBase' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(container);
  });

  it('uses plain "BrainBase" in visible text — no hand-typed Λ outside the verbatim legal notice', () => {
    const { container } = renderBrainbase(<RequestDemoPage />);
    const notice = [...container.querySelectorAll('p')].find(p =>
      p.textContent?.includes('Brainbase (ABN 32 207 559 504)'),
    );
    expect(notice?.textContent).toContain('trading as BRΛINBΛSE, collects');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const offenders: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement!;
      if (el.closest('[aria-hidden="true"]') || (notice && notice.contains(el))) continue;
      if (node.textContent?.includes('Λ')) offenders.push(node.textContent.trim());
    }
    expect(offenders).toEqual([]);
    expect(screen.getByRole('link', { name: '← Back to BrainBase' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('textbox', { name: 'How did you hear about BrainBase?' })).toBeInTheDocument();
  });

  it('keeps every destination the page previously linked to', () => {
    const { container } = renderBrainbase(<RequestDemoPage />);
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of ['/', '/privacy']) expect(hrefs).toContain(href);
  });
});
