import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// P3 (authenticated visual-completion pass) — the Helena conversation
// surface rendered for real (jsdom) in light and dark: the docked (/hlna)
// and floating (/dashboard, service dashboards) ChatPanel, and the /hlna
// workspace chrome around it. Asserts the accessibility contract the pass
// added (labelled composer, named icon-only controls, pressed/expanded
// state, conversation region) and that axe finds nothing. The voice / chat
// state machine is mocked — its behaviour is pinned by the containment
// suite, not re-tested here.

const helenaState = {
  messages: [] as Array<Record<string, unknown>>,
  responding: false,
  transcript: '',
  listening: false,
  conversational: false,
  micError: null as string | null,
  orbPhase: 'idle',
  pendingOrganiserAction: null,
  organiserActionSubmitting: false,
};

const helena = {
  ...helenaState,
  speechPulseRef: { current: null },
  enableWakeWord: vi.fn(),
  disableWakeWord: vi.fn(),
  startListening: vi.fn(),
  stopAndSend: vi.fn(),
  startConversation: vi.fn(),
  stopConversation: vi.fn(),
  sendMessage: vi.fn(),
  confirmOrganiserAction: vi.fn(),
  cancelOrganiserAction: vi.fn(),
};

vi.mock('@/hooks/useHelena', () => ({ useHelena: () => helena }));
const toggleBrainGraph = vi.fn();
vi.mock('@/lib/state/useAppStore', () => ({
  useAppStore: () => ({ brainGraphOpen: false, toggleBrainGraph, orbAlert: false }),
}));
// three.js graph — rendered only on demand, not part of this surface.
vi.mock('@/components/panels/BrainGraphPanel', () => ({ BrainGraphPanel: () => null }));

// ChatPanel is plain JSX, so its inferred prop types mark every optional
// callback as required — widen it for the fixtures below.
const ChatPanel = (await import('@/components/chat/ChatPanel')).ChatPanel as unknown as ComponentType<Record<string, unknown>>;
const { default: HelenaWorkspace } = await import('@/components/helena/HelenaWorkspace');

const MESSAGES = [
  { role: 'user', content: 'Which projects are overdue this week?' },
  {
    role: 'assistant',
    content: 'Two projects are overdue: the intake review and the supplier audit.',
    meta: {
      agentName: 'InsightAgent',
      confidence: 0.84,
      findings: ['Intake review is 3 days late', 'Supplier audit is 1 day late'],
      evidence: {
        sourceDataset: ['projects'],
        sourceColumns: ['name', 'due_date', 'status'],
        evidenceSummary: 'Two open projects have a due date before today.',
        calculationUsed: 'count(status != done AND due_date < today)',
        confidenceReason: 'Due dates are complete for every open project.',
        sampleRows: [{ name: 'Intake review', due_date: '2026-09-24', status: 'Open' }],
      },
    },
  },
];

const PENDING_COMMENT = {
  tool: 'propose_organiser_comment',
  receivedAt: Date.now(),
  proposal: { item_name: 'Supplier audit', body: 'Following up on the audit today.' },
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Element.prototype.scrollIntoView = vi.fn();
  helena.sendMessage.mockReset();
});

describe.each(['light', 'dark'] as const)('Helena conversation surface (%s)', theme => {
  it('docked ChatPanel: labelled composer, primary Send, named conversation region, confirmation card', async () => {
    const onSend = vi.fn();
    const onConfirm = vi.fn();
    const { container, user } = renderBrainbase(
      <ChatPanel
        layout="docked"
        messages={MESSAGES}
        responding={false}
        transcript=""
        onSend={onSend}
        pendingOrganiserAction={PENDING_COMMENT}
        onConfirmOrganiserAction={onConfirm}
        onCancelOrganiserAction={vi.fn()}
      />, { theme });

    const log = screen.getByRole('region', { name: 'HLNA conversation' });
    expect(within(log).getByText('Which projects are overdue this week?')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Helena Organiser action awaiting your confirmation' });
    expect(within(card).getByText('Post comment')).toBeInTheDocument();

    const input = screen.getByLabelText('Message HLNA');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(input, 'Show me the audit');
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith('Show me the audit');

    await user.click(within(card).getByRole('button', { name: 'Confirm: post this exact comment now' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // docked mode has no close control
    expect(screen.queryByRole('button', { name: 'Close chat' })).toBeNull();

    const evidence = screen.getByRole('button', { name: '▼ EVIDENCE' });
    expect(evidence).toHaveAttribute('aria-expanded', 'false');
    await user.click(evidence);
    expect(screen.getByRole('button', { name: '▲ EVIDENCE' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('columnheader', { name: 'due_date' })).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });

  it('floating ChatPanel: named close control and a live thinking status while responding', async () => {
    const onClose = vi.fn();
    const { container, user } = renderBrainbase(
      <ChatPanel messages={[]} responding transcript="what is due" onSend={vi.fn()} onClose={onClose} />, { theme });

    expect(screen.getByText('ESC TO CLOSE')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Routing…');
    expect(screen.getByText('what is due')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await expectNoAxeViolations(container);
  });

  it('/hlna workspace chrome: named header controls, a pressed-state mic and the text state label', async () => {
    const { container, user } = renderBrainbase(<HelenaWorkspace />, { theme });

    // Deferred-issues pass (N5): exactly one page-level h1, visually hidden
    // because the wordmark is the visible identity.
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('HLNΛ workspace');
    expect(h1s[0]).toHaveClass('sr-only');

    expect(screen.getByRole('link', { name: 'BRΛINBΛSE home' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/account/profile');
    const perf = screen.getByRole('button', { name: /Performance/ });
    expect(perf).toHaveAttribute('aria-pressed', 'false');
    await user.click(perf);
    expect(toggleBrainGraph).toHaveBeenCalled();

    const mic = screen.getByRole('button', { name: 'Start listening' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    await user.click(mic);
    expect(helena.startConversation).toHaveBeenCalled();

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Helena — idle' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message HLNA')).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });
});
