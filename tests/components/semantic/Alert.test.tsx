import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Alert, SEMANTIC_STATES } from '@/components/ui/semantic';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectDecorative, expectDescribedBy, expectLabelledBy } from '../../a11y/accessibility';
import { expectKeyboardActivation, expectNamedFocusOrder } from '../../a11y/keyboard';
import { expectAssertiveLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';

const TITLE = 'Sync failed';
const BODY = 'BrainBase could not reach Microsoft 365. Check the connection and try again.';

describe('Alert', () => {
  it.each(SEMANTIC_STATES)('has no axe violations in state "%s"', async state => {
    const { container } = renderBrainbase(
      <Alert state={state} title={TITLE} onDismiss={() => {}} actions={[{ label: 'Retry', onClick: () => {} }]}>
        {BODY}
      </Alert>,
    );
    await expectNoAxeViolations(container);
  });

  it('is labelled by its title and described by its body', () => {
    renderBrainbase(<Alert title={TITLE}>{BODY}</Alert>);
    const alert = screen.getByRole('group');
    expectLabelledBy(alert, screen.getByText(TITLE));
    expectDescribedBy(alert, screen.getByText(BODY));
  });

  it('is not role="alert" unless it is a critical error', () => {
    renderBrainbase(<Alert state="error" title={TITLE}>{BODY}</Alert>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses role="alert" for a critical error', () => {
    renderBrainbase(
      <Alert state="error" urgency="critical" title={TITLE}>
        {BODY}
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expectAssertiveLiveRegion(alert);
    expectLabelledBy(alert, screen.getByText(TITLE));
    expectDescribedBy(alert, screen.getByText(BODY));
  });

  it('downgrades "critical" on a non-error state to polite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderBrainbase(
      <Alert state="warning" urgency="critical" title="Storage almost full">
        Free up space to keep importing.
      </Alert>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expectPoliteLiveRegion(screen.getByRole('status'));
    warn.mockRestore();
  });

  it('hides the decorative icons', () => {
    const { container } = renderBrainbase(
      <Alert title={TITLE} onDismiss={() => {}}>
        {BODY}
      </Alert>,
    );
    container.querySelectorAll('svg').forEach(expectDecorative);
  });

  it('has a logical tab order: dismiss, then actions', async () => {
    const { user } = renderBrainbase(
      <Alert
        title={TITLE}
        onDismiss={() => {}}
        actions={[
          { label: 'Retry', onClick: () => {}, primary: true },
          { label: 'View details', onClick: () => {} },
        ]}
      >
        {BODY}
      </Alert>,
    );
    await expectNamedFocusOrder(user, ['Dismiss: Sync failed', 'Retry', 'View details']);
  });

  it('actions work with Enter and Space', async () => {
    const retry = vi.fn();
    const { user } = renderBrainbase(
      <Alert title={TITLE} actions={[{ label: 'Retry', onClick: retry }]}>
        {BODY}
      </Alert>,
    );
    const button = screen.getByRole('button', { name: 'Retry' });
    await expectKeyboardActivation(user, button, retry, 'Enter');
    await expectKeyboardActivation(user, button, retry, 'Space');
  });

  it('can be dismissed from the keyboard', async () => {
    function Dismissible() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Alert title={TITLE} onDismiss={() => setOpen(false)}>
          {BODY}
        </Alert>
      ) : (
        <p>Dismissed</p>
      );
    }
    const { user } = renderBrainbase(<Dismissible />);
    screen.getByRole('button', { name: 'Dismiss: Sync failed' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
  });
});
