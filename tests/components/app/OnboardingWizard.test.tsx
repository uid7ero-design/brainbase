import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass — the onboarding wizard rendered in jsdom in
// both themes and walked end to end against a STUBBED fetch (nothing is ever
// submitted for real; synthetic fixtures only). Pins that the convergence
// kept step order, validation, persistence calls, upload/mapping, review and
// submission, and asserts the accessibility contract: one page h1, labelled
// controls (Field), pressed-state selections, step list with aria-current.

vi.mock('next/navigation', () => ({
  usePathname: () => '/onboarding',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: OnboardingWizard } = await import('@/app/onboarding/_components/OnboardingWizard');

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/onboarding/progress' && method === 'GET') return json({ completed: false, data: {} });
    if (url === '/api/onboarding/progress' && method === 'POST') return json({ ok: true });
    if (url === '/api/onboarding/upload') {
      return json({
        fileId: 'f-1', fileName: 'synthetic-waste.csv',
        headers: ['Service Type', 'Suburb', 'Month', 'Tonnes'],
        rows: [['Kerbside', 'Northgate', 'Jul', '12.5']],
      });
    }
    if (url === '/api/onboarding/submit') return json({ ok: true });
    return new Response('not found', { status: 404 });
  }));
});

const stepH2 = () => screen.getAllByRole('heading', { level: 2 })[0];
const current = () => screen.getByRole('list', { name: /Onboarding progress/ }).querySelector('[aria-current="step"]');

describe.each(['light', 'dark'] as const)('Onboarding wizard (%s)', theme => {
  it('renders one h1, a step list with the current step, labelled fields, and no axe violations', async () => {
    const { container } = renderBrainbase(<OnboardingWizard organisationId="org-test" userId="u-test" />, { theme });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Onboarding');
    expect(stepH2()).toHaveTextContent('Tell us about your organisation');
    expect(current()).toHaveTextContent('Organisation');
    expect(screen.getByRole('list', { name: 'Onboarding progress, step 1 of 7' }).querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByLabelText(/Council \/ Organisation Name/)).toHaveAttribute('placeholder', 'e.g. City of Adelaide');
    expect(screen.getByLabelText(/Contact Email/)).toHaveAttribute('type', 'email');
    await waitFor(() => expect(calls.some(c => c.url === '/api/onboarding/progress' && c.method === 'GET')).toBe(true));
    await expectNoAxeViolations(container);
  });

  it('keeps validation: empty submit shows field errors, marks inputs invalid and does not advance', async () => {
    const { user, container } = renderBrainbase(<OnboardingWizard organisationId="org-test" userId="u-test" />, { theme });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const name = screen.getByLabelText(/Council \/ Organisation Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required');
    expect(stepH2()).toHaveTextContent('Tell us about your organisation');
    expect(calls.some(c => c.method === 'POST')).toBe(false);
    await expectNoAxeViolations(container);
  });

  it('walks every step in order against a stubbed fetch and submits the same payload shape', async () => {
    const { user, container } = renderBrainbase(<OnboardingWizard organisationId="org-test" userId="u-test" />, { theme });

    // Step 1
    await user.type(screen.getByLabelText(/Council \/ Organisation Name/), 'Synthetic Council');
    await user.type(screen.getByLabelText(/Primary Contact Name/), 'Test Person');
    await user.type(screen.getByLabelText(/Contact Email/), 'test@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'What systems do you use?' });
    const firstPost = calls.find(c => c.url === '/api/onboarding/progress' && c.method === 'POST');
    expect(JSON.parse(String(firstPost?.body))).toMatchObject({ currentStep: 2, data: { org: { councilName: 'Synthetic Council', contactName: 'Test Person', contactEmail: 'test@example.test' } } });
    expect(current()).toHaveTextContent('Data Sources');

    // Step 2 — pressed-state selection tiles
    const systems = screen.getByRole('group', { name: 'Finance & Operations Systems' });
    const techOne = within(systems).getByRole('button', { name: 'TechOne' });
    expect(techOne).toHaveAttribute('aria-pressed', 'false');
    await user.click(techOne);
    expect(techOne).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(screen.getByRole('group', { name: 'How do you export your data?' })).getByRole('button', { name: /CSV exports/ }));
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Waste data mapping' });

    // Step 3 — upload (stubbed) → auto-mapped, labelled selects
    const drop = screen.getByRole('button', { name: /Drop your waste CSV or XLSX here/ });
    expect(drop).toHaveAttribute('type', 'button');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('.csv,.xlsx,.xls');
    fireEvent.change(input, { target: { files: [new File(['a,b'], 'synthetic-waste.csv', { type: 'text/csv' })] } });
    await screen.findByText('synthetic-waste.csv');
    const upload = calls.find(c => c.url === '/api/onboarding/upload');
    expect(upload?.method).toBe('POST');
    expect((upload?.body as globalThis.FormData).get('serviceType')).toBe('waste');
    const serviceSelect = screen.getByRole('combobox', { name: 'Service Type' }) as HTMLSelectElement;
    expect(serviceSelect.value).toBe('Service Type');
    expect(screen.getByRole('combobox', { name: 'Tonnes' })).toHaveValue('Tonnes');
    expect(screen.getByRole('region', { name: 'Column mapping' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data preview' })).toHaveTextContent('Northgate');
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'Fleet data mapping' });

    // Step 4 — skip
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { level: 2, name: 'A few questions for HLNA' });

    // Step 5 — labelled textareas
    await user.type(screen.getByLabelText('What are your biggest operational challenges right now?'), 'Synthetic challenge');
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { level: 2, name: 'What does success look like?' });

    // Step 6 — goals
    const goal = screen.getByRole('button', { name: /Fleet efficiency/ });
    await user.click(goal);
    expect(goal).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 goal selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review & Submit' }));
    await screen.findByRole('heading', { level: 2, name: 'Review & confirm' });

    // Step 7 — review content + submit
    expect(screen.getByRole('heading', { level: 3, name: 'Organisation' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic Council').tagName).toBe('DD');
    expect(screen.getByText('techone')).toBeInTheDocument();
    expect(screen.getByText('synthetic-waste.csv')).toBeInTheDocument();
    expect(screen.getByText('No fleet file uploaded — can be added later.')).toBeInTheDocument();
    expect(screen.getByText('Synthetic challenge')).toBeInTheDocument();
    expect(screen.getByText('Fleet efficiency').tagName).toBe('LI');
    expect(current()).toHaveTextContent('Review');
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Complete Setup' }));
    await screen.findByRole('heading', { level: 1, name: "You're all set!" });
    const submit = calls.find(c => c.url === '/api/onboarding/submit');
    expect(submit?.method).toBe('POST');
    const payload = JSON.parse(String(submit?.body));
    expect(Object.keys(payload)).toEqual(['data']);
    expect(Object.keys(payload.data)).toEqual(['org', 'sources', 'wasteMapping', 'fleetMapping', 'questions', 'metrics']);
    expect(payload.data.metrics.goals).toEqual(['fleet_efficiency']);
    expect(payload.data.wasteMapping.mappings.service_type).toBe('Service Type');
    expect(localStorage.getItem('bb_onboarding_org-test')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/dashboard/overview');
    await expectNoAxeViolations(container);
  }, 30000);

  it('Back returns to the previous step', async () => {
    localStorage.setItem('bb_onboarding_org-test', JSON.stringify({ step: 3, formData: undefined }));
    const { user } = renderBrainbase(<OnboardingWizard organisationId="org-test" userId="u-test" />, { theme });
    await screen.findByRole('heading', { level: 2, name: 'Waste data mapping' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 2, name: 'What systems do you use?' });
  });
});
