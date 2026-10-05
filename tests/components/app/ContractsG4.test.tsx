import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Review G4 — behaviour contracts for /dashboards and the /onboarding wizard.
// Every expected value below was derived from the BASE commit (ecb5b03), not
// from the current working tree: step order + titles, Step 1 validation,
// persistence (localStorage key/shape, progress POST), upload via drop and
// file input (URL, method, FormData, auto-mapped state), the final submit
// (URL, method, headers, exact payload), and no accidental submit buttons.
// For /dashboards: module list, hrefs, titles, categories, filter counts and
// module identity colours. fetch is stubbed; nothing touches the network.

vi.mock('next/navigation', () => ({
  usePathname: () => '/onboarding',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: OnboardingWizard } = await import('@/app/onboarding/_components/OnboardingWizard');
const { default: DashboardsPage } = await import('@/app/dashboards/page');

// ── Base (ecb5b03) constants ─────────────────────────────────────────────

const BASE_STEP_LABELS = ['Organisation', 'Data Sources', 'Waste Data', 'Fleet Data', 'Questions', 'Goals', 'Review'];
const BASE_STEP_TITLES = [
  'Tell us about your organisation',
  'What systems do you use?',
  'Waste data mapping',
  'Fleet data mapping',
  'A few questions for HLNA',
  'What does success look like?',
  'Review & confirm',
];

const BASE_CATEGORIES: [string, number][] = [
  ['All', 13],
  ['Local Government', 5],
  ['Logistics & Transport', 3],
  ['Construction', 1],
  ['Utilities', 2],
  ['Commercial', 2],
];

const BASE_MODULES: { href: string; title: string; category: string; color: string }[] = [
  { href: '/dashboard/waste', title: 'Waste & Recycling', category: 'Local Government', color: '#10b981' },
  { href: '/dashboard/fleet', title: 'Fleet Management', category: 'Local Government', color: '#3b82f6' },
  { href: '/dashboard/logistics', title: 'Logistics & Freight', category: 'Logistics & Transport', color: '#f59e0b' },
  { href: '/dashboard/construction', title: 'Construction Projects', category: 'Construction', color: '#f97316' },
  { href: '/dashboard/roads', title: 'Roads & Infrastructure', category: 'Local Government', color: '#64748b' },
  { href: '/dashboard/water', title: 'Water & Utilities', category: 'Utilities', color: '#06b6d4' },
  { href: '/dashboard/parks', title: 'Parks & Open Spaces', category: 'Local Government', color: '#22c55e' },
  { href: '/dashboard/facilities', title: 'Facilities Management', category: 'Commercial', color: '#8b5cf6' },
  { href: '/dashboard/depot', title: 'Depot & Yard Operations', category: 'Logistics & Transport', color: '#ec4899' },
  { href: '/dashboard/supply', title: 'Supply Chain', category: 'Logistics & Transport', color: '#0ea5e9' },
  { href: '/dashboard/labour', title: 'Labour & Workforce', category: 'Commercial', color: '#a855f7' },
  { href: '/dashboard/environment', title: 'Environmental & ESG', category: 'Utilities', color: '#16a34a' },
  { href: '/dashboard/wste', title: 'WSTe — Waste Service Tracking', category: 'Local Government', color: '#2DD4BF' },
];

// ── Stubbed fetch ────────────────────────────────────────────────────────

type Call = { url: string; method: string; body: unknown; headers: unknown };
let calls: Call[];
let submitStatus = 200;
let progressGet: unknown = { completed: false, data: {} };

const WASTE_UPLOAD = {
  fileId: 'wf-1', fileName: 'synthetic-waste.csv',
  headers: ['Service Type', 'Suburb', 'Month', 'Tonnes', 'Collections', 'Cost'],
  rows: [['Kerbside', 'Northgate', 'Jul', '12.5', '400', '900']],
};
const FLEET_UPLOAD = {
  fileId: 'ff-1', fileName: 'synthetic-fleet.csv',
  headers: ['Rego', 'Month', 'KM', 'Fuel'],
  rows: [['S123', 'Jul', '1200', '310']],
};

beforeEach(() => {
  localStorage.clear();
  calls = [];
  submitStatus = 200;
  progressGet = { completed: false, data: {} };
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body, headers: init?.headers });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/onboarding/progress' && method === 'GET') return json(progressGet);
    if (url === '/api/onboarding/progress' && method === 'POST') return json({ ok: true });
    if (url === '/api/onboarding/upload') {
      const kind = (init?.body as globalThis.FormData).get('serviceType');
      return json(kind === 'fleet' ? FLEET_UPLOAD : WASTE_UPLOAD);
    }
    if (url === '/api/onboarding/submit') return json({ ok: submitStatus === 200 }, submitStatus);
    return new Response('not found', { status: 404 });
  }));
});

const h2 = () => screen.getAllByRole('heading', { level: 2 })[0];
const posts = (url: string) => calls.filter(c => c.url === url && c.method === 'POST');
const renderWizard = () => renderBrainbase(<OnboardingWizard organisationId="org-g4" userId="u-g4" />, { theme: 'light' });

/** Every <button> inside a <form> has an explicit type; exactly one is the submit, carrying the expected label. */
function expectNoAccidentalSubmit(container: HTMLElement, nextLabel: RegExp) {
  const forms = container.querySelectorAll('form');
  expect(forms).toHaveLength(1);
  const buttons = Array.from(forms[0].querySelectorAll('button'));
  for (const b of buttons) expect(b.hasAttribute('type'), `button "${b.textContent}" has no type`).toBe(true);
  const submits = buttons.filter(b => b.getAttribute('type') === 'submit');
  expect(submits).toHaveLength(1);
  expect(submits[0].textContent).toMatch(nextLabel);
}

async function fillStep1(user: ReturnType<typeof renderBrainbase>['user']) {
  await user.type(screen.getByPlaceholderText('e.g. City of Adelaide'), 'Synthetic Council');
  await user.type(screen.getByPlaceholderText('Jane Smith'), 'Test Person');
  await user.type(screen.getByPlaceholderText('jane@council.gov.au'), 'test@example.test');
}

// ── Onboarding ───────────────────────────────────────────────────────────

describe('G4 contract — onboarding wizard', () => {
  it('Step 1 validation gates exactly as base: Required ×3 when empty, Invalid email, no advance, no persistence', async () => {
    const { user } = renderWizard();
    expect(h2()).toHaveTextContent(BASE_STEP_TITLES[0]);
    const before = screen.queryAllByText('Required').length;
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.queryAllByText('Required').length - before).toBe(3);
    expect(h2()).toHaveTextContent(BASE_STEP_TITLES[0]);

    await user.type(screen.getByPlaceholderText('e.g. City of Adelaide'), 'Synthetic Council');
    await user.type(screen.getByPlaceholderText('Jane Smith'), 'Test Person');
    await user.type(screen.getByPlaceholderText('jane@council.gov.au'), 'not-an-email');
    // jsdom does not run constraint validation for type=email on requestSubmit via click; the base JS regex does the gating.
    fireEvent.submit(screen.getByPlaceholderText('jane@council.gov.au').closest('form')!);
    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(h2()).toHaveTextContent(BASE_STEP_TITLES[0]);
    expect(posts('/api/onboarding/progress')).toHaveLength(0);
    expect(localStorage.getItem('bb_onboarding_org-g4')).toBeNull();
  });

  it('walks the base step order/titles, persists {step, formData}, uploads via drop + file input, and submits the exact base payload', async () => {
    const { user, container } = renderWizard();
    await waitFor(() => expect(calls.some(c => c.url === '/api/onboarding/progress' && c.method === 'GET')).toBe(true));
    // Progress labels appear first in the DOM, in base order.
    const text = container.textContent ?? '';
    let at = -1;
    for (const label of BASE_STEP_LABELS) {
      const next = text.indexOf(label, at + 1);
      expect(next, `step label "${label}" out of order`).toBeGreaterThan(at);
      at = next;
    }
    expect(at).toBeLessThan(text.indexOf(BASE_STEP_TITLES[0]));

    // Step 1
    expectNoAccidentalSubmit(container, /^Continue\s*→$/);
    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[1] });

    const p1 = posts('/api/onboarding/progress')[0];
    expect(p1.headers).toEqual({ 'Content-Type': 'application/json' });
    const org = { councilName: 'Synthetic Council', contactName: 'Test Person', contactEmail: 'test@example.test' };
    expect(JSON.parse(String(p1.body))).toEqual({
      currentStep: 2,
      data: {
        org,
        sources: { systems: [], fileTypes: [] },
        wasteMapping: { mappings: {} },
        fleetMapping: { mappings: {} },
        questions: { challenges: '', goals: '', reporting: '', other: '' },
        metrics: { goals: [] },
      },
    });
    const stored = JSON.parse(localStorage.getItem('bb_onboarding_org-g4')!);
    expect(Object.keys(stored).sort()).toEqual(['formData', 'step']);
    expect(stored.step).toBe(2);
    expect(stored.formData.org).toEqual(org);

    // Step 2 — tiles are type=button toggles
    expectNoAccidentalSubmit(container, /^Continue\s*→$/);
    await user.click(screen.getByRole('button', { name: /TechOne/ }));
    await user.click(screen.getByRole('button', { name: /^SAP$/ }));
    await user.click(screen.getByRole('button', { name: /CSV exports/ }));
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[2] });

    // Step 3 — the Back and "Skip for now" buttons before upload
    expectNoAccidentalSubmit(container, /^Skip for now\s*→$/);
    const wasteInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(wasteInput.getAttribute('accept')).toBe('.csv,.xlsx,.xls');
    fireEvent.change(wasteInput, { target: { files: [new File(['a'], 'synthetic-waste.csv', { type: 'text/csv' })] } });
    await screen.findByText('synthetic-waste.csv');
    const up1 = posts('/api/onboarding/upload')[0];
    expect(up1.body).toBeInstanceOf(globalThis.FormData);
    expect((up1.body as globalThis.FormData).get('serviceType')).toBe('waste');
    expect(((up1.body as globalThis.FormData).get('file') as File).name).toBe('synthetic-waste.csv');
    // Replace + Continue after upload — still no accidental submit
    expectNoAccidentalSubmit(container, /^Continue\s*→$/);
    // change one mapping by hand (base: MappingTable onChange merges into mappings)
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(8); // WASTE_FIELDS
    fireEvent.change(selects[6], { target: { value: 'Cost' } }); // contamination_rate
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[3] });

    // Step 4 — upload via DROP on the drop zone
    const dropText = screen.getByText('Drop your fleet CSV or XLSX here');
    fireEvent.dragOver(dropText);
    fireEvent.drop(dropText, { dataTransfer: { files: [new File(['b'], 'synthetic-fleet.csv', { type: 'text/csv' })] } });
    await screen.findByText('synthetic-fleet.csv');
    const up2 = posts('/api/onboarding/upload')[1];
    expect((up2.body as globalThis.FormData).get('serviceType')).toBe('fleet');
    expect(container.querySelectorAll('select')).toHaveLength(18); // FLEET_FIELDS
    expectNoAccidentalSubmit(container, /^Continue\s*→$/);
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[4] });

    // Step 5
    expectNoAccidentalSubmit(container, /^Continue\s*→$/);
    const tas = container.querySelectorAll('textarea');
    expect(tas).toHaveLength(4);
    await user.type(tas[0], 'Synthetic challenge');
    await user.type(tas[3], 'Synthetic other');
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[5] });

    // Step 6
    expectNoAccidentalSubmit(container, /^Review & Submit\s*→$/);
    await user.click(screen.getByRole('button', { name: /Fleet efficiency/ }));
    await user.click(screen.getByRole('button', { name: /Automate reporting/ }));
    expect(screen.getByText('2 goals selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review & Submit/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[6] });

    // Step 7 — not a form in base; both buttons explicit type=button
    expect(container.querySelector('form')).toBeNull();
    const reviewButtons = Array.from(container.querySelectorAll('button'));
    expect(reviewButtons.map(b => b.getAttribute('type'))).toEqual(['button', 'button']);
    expect(posts('/api/onboarding/progress').map(c => JSON.parse(String(c.body)).currentStep)).toEqual([2, 3, 4, 5, 6, 7]);

    await user.click(screen.getByRole('button', { name: /Complete Setup/ }));
    await screen.findByRole('heading', { level: 1, name: "You're all set!" });

    const submit = posts('/api/onboarding/submit');
    expect(submit).toHaveLength(1);
    expect(submit[0].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(submit[0].body))).toEqual({
      data: {
        org,
        sources: { systems: ['techone', 'sap'], fileTypes: ['csv'] },
        wasteMapping: {
          ...WASTE_UPLOAD,
          mappings: {
            service_type: 'Service Type', suburb: 'Suburb', month: 'Month', tonnes: 'Tonnes',
            collections: 'Collections', cost: 'Cost', contamination_rate: 'Cost',
          },
        },
        fleetMapping: {
          ...FLEET_UPLOAD,
          mappings: { vehicle_id: 'Rego', month: 'Month', km: 'KM', fuel: 'Fuel' },
        },
        questions: { challenges: 'Synthetic challenge', goals: '', reporting: '', other: 'Synthetic other' },
        metrics: { goals: ['fleet_efficiency', 'reporting_automation'] },
      },
    });
    expect(localStorage.getItem('bb_onboarding_org-g4')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/dashboard/overview');
  }, 40000);

  it('restores {step, formData} from localStorage without a server GET; Back navigates without persisting', async () => {
    localStorage.setItem('bb_onboarding_org-g4', JSON.stringify({
      step: 5,
      formData: {
        org: { councilName: 'A', contactName: 'B', contactEmail: 'c@d.test' },
        sources: { systems: [], fileTypes: [] },
        wasteMapping: { mappings: {} }, fleetMapping: { mappings: {} },
        questions: { challenges: 'Restored', goals: '', reporting: '', other: '' },
        metrics: { goals: [] },
      },
    }));
    const { user, container } = renderWizard();
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[4] });
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Restored');
    expect(calls.filter(c => c.url === '/api/onboarding/progress' && c.method === 'GET')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Back/ }));
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[3] });
    expect(calls).toHaveLength(0);
  });

  it('falls back to the server progress when nothing is stored locally', async () => {
    progressGet = { completed: false, currentStep: 3, data: { org: { councilName: 'Srv', contactName: 'X', contactEmail: 'x@y.test' } } };
    renderWizard();
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[2] });
  });

  it('a failed submit keeps the review step and the saved draft (base: only res.ok clears storage)', async () => {
    submitStatus = 500;
    localStorage.setItem('bb_onboarding_org-g4', JSON.stringify({ step: 7, formData: {
      org: { councilName: 'A', contactName: 'B', contactEmail: 'c@d.test' },
      sources: { systems: [], fileTypes: [] }, wasteMapping: { mappings: {} }, fleetMapping: { mappings: {} },
      questions: { challenges: '', goals: '', reporting: '', other: '' }, metrics: { goals: [] },
    } }));
    const { user } = renderWizard();
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[6] });
    await user.click(screen.getByRole('button', { name: /Complete Setup/ }));
    await waitFor(() => expect(posts('/api/onboarding/submit')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete Setup/ })).not.toBeDisabled());
    expect(h2()).toHaveTextContent(BASE_STEP_TITLES[6]);
    expect(localStorage.getItem('bb_onboarding_org-g4')).not.toBeNull();
  });

  it('upload errors surface the base messages (json.error, else "Upload failed"; throw → retry copy)', async () => {
    localStorage.setItem('bb_onboarding_org-g4', JSON.stringify({ step: 3, formData: {
      org: { councilName: 'A', contactName: 'B', contactEmail: 'c@d.test' },
      sources: { systems: [], fileTypes: [] }, wasteMapping: { mappings: {} }, fleetMapping: { mappings: {} },
      questions: { challenges: '', goals: '', reporting: '', other: '' }, metrics: { goals: [] },
    } }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/onboarding/upload') return new Response(JSON.stringify({ error: 'Bad synthetic file' }), { status: 400 });
      return new Response('{}', { status: 200 });
    }));
    const { container } = renderWizard();
    await screen.findByRole('heading', { level: 2, name: BASE_STEP_TITLES[2] });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'x.csv')] } });
    expect(await screen.findByText('Bad synthetic file')).toBeInTheDocument();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    fireEvent.drop(screen.getByText('Drop your waste CSV or XLSX here'), { dataTransfer: { files: [new File(['x'], 'y.csv')] } });
    expect(await screen.findByText('Upload failed. Please try again.')).toBeInTheDocument();
  });
});

// ── /dashboards ──────────────────────────────────────────────────────────

describe('G4 contract — /dashboards module library', () => {
  it('module list, hrefs, titles, and identity colours are identical to base', () => {
    const { container } = renderBrainbase(<DashboardsPage />, { theme: 'light' });
    const moduleLinks = Array.from(container.querySelectorAll('a')).filter(a => (a.getAttribute('href') ?? '').startsWith('/dashboard/'));
    expect(moduleLinks.map(a => a.getAttribute('href'))).toEqual(BASE_MODULES.map(m => m.href));
    moduleLinks.forEach((a, i) => {
      expect(within(a).getByRole('heading', { level: 3 })).toHaveTextContent(BASE_MODULES[i].title);
      expect(a).toHaveTextContent(BASE_MODULES[i].category);
      expect(a.style.getPropertyValue('--module-color')).toBe(BASE_MODULES[i].color);
    });
    expect(screen.getByRole('link', { name: /Open Command Centre/ })).toHaveAttribute('href', '/command');
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
  });

  it('filter categories, counts and per-category results are identical to base', async () => {
    const { user, container } = renderBrainbase(<DashboardsPage />, { theme: 'light' });
    const filterButtons = Array.from(container.querySelectorAll('button')).filter(b => BASE_CATEGORIES.some(([c]) => b.textContent?.startsWith(c)));
    expect(filterButtons.map(b => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(BASE_CATEGORIES.map(([c, n]) => `${c}${n}`.replace(/\s+/g, ' ')));
    for (const [category, count] of BASE_CATEGORIES) {
      await user.click(filterButtons.find(b => b.textContent?.startsWith(category))!);
      const expected = category === 'All' ? BASE_MODULES : BASE_MODULES.filter(m => m.category === category);
      expect(expected).toHaveLength(count);
      const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(h => h?.startsWith('/dashboard/'));
      expect(hrefs).toEqual(expected.map(m => m.href));
      expect(screen.getByRole('heading', { level: 2, name: category === 'All' ? 'Your operational intelligence library.' : category })).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`^${count} dashboards? available and ready to open\\.$`))).toBeInTheDocument();
    }
  });
});
