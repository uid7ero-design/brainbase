import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { LiveRegion, TRANSITION_ANNOUNCEMENTS } from '@/components/ui/semantic';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectAssertiveLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';

describe('LiveRegion', () => {
  it('is polite by default', async () => {
    const { container } = renderBrainbase(<LiveRegion message="" />);
    expectPoliteLiveRegion(screen.getByRole('status'));
    await expectNoAxeViolations(container);
  });

  it('supports assertive for a critical failure', () => {
    renderBrainbase(<LiveRegion message={TRANSITION_ANNOUNCEMENTS.connectionLost} politeness="assertive" />);
    expectAssertiveLiveRegion(screen.getByRole('alert'));
  });

  it('stays mounted and swaps its message on transitions', () => {
    const { rerender } = renderBrainbase(<LiveRegion message="" />);
    const region = screen.getByRole('status');

    rerender(<LiveRegion message={TRANSITION_ANNOUNCEMENTS.syncStarted} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Sync started');

    rerender(<LiveRegion message={TRANSITION_ANNOUNCEMENTS.syncComplete} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Sync complete');
  });

  it('is atomic so the whole message is read', () => {
    renderBrainbase(<LiveRegion message={TRANSITION_ANNOUNCEMENTS.connectionRestored} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
  });

  it('is visually hidden by default but can be shown', () => {
    const { rerender } = renderBrainbase(<LiveRegion message="Sync complete" />);
    expect(screen.getByRole('status')).toHaveClass('bb-visually-hidden');
    rerender(<LiveRegion message="Sync complete" visuallyHidden={false} />);
    expect(screen.getByRole('status')).not.toHaveClass('bb-visually-hidden');
  });
});
