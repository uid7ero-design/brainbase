import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Banner, SEMANTIC_STATES } from '@/components/ui/semantic';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectAccessibleName, expectDecorative } from '../../a11y/accessibility';
import { expectKeyboardActivation, expectNamedFocusOrder } from '../../a11y/keyboard';
import { expectAssertiveLiveRegion, expectNotLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';
import { expectSemanticState } from '../../a11y/semantic-state';

describe('Banner', () => {
  it.each(SEMANTIC_STATES)('has no axe violations in state "%s"', async state => {
    const { container } = renderBrainbase(
      <Banner state={state} title="Import complete" onDismiss={() => {}}>
        42 records were added.
      </Banner>,
    );
    await expectNoAxeViolations(container);
  });

  it('is static page information by default — not a live region', () => {
    renderBrainbase(<Banner state="info" title="Import complete" />);
    expectNotLiveRegion(screen.getByText('Import complete'));
    expect(screen.getByRole('region', { name: 'Import complete' })).toBeInTheDocument();
  });

  it('uses polite status semantics when announced dynamically', () => {
    renderBrainbase(<Banner state="success" title="Import complete" announce="polite" />);
    const banner = screen.getByRole('status');
    expectPoliteLiveRegion(banner);
    expectSemanticState(banner, 'success', 'Import complete');
  });

  it('uses alert semantics for a critical error', () => {
    renderBrainbase(<Banner state="error" title="Connection lost" announce="assertive" />);
    expectAssertiveLiveRegion(screen.getByRole('alert'));
  });

  it('downgrades an assertive request on a non-error state to polite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderBrainbase(<Banner state="warning" title="Sources need attention" announce="assertive" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expectPoliteLiveRegion(screen.getByRole('status'));
    warn.mockRestore();
  });

  it('hides the decorative icon', () => {
    const { container } = renderBrainbase(<Banner state="warning" title="Sources need attention" />);
    expectDecorative(container.querySelector('svg')!);
  });

  it('has a descriptive dismiss label', () => {
    renderBrainbase(<Banner state="info" title="Import complete" onDismiss={() => {}} />);
    expectAccessibleName(screen.getByRole('button'), 'Dismiss: Import complete');
  });

  it('accepts a custom dismiss label', () => {
    renderBrainbase(
      <Banner state="info" title="Import complete" onDismiss={() => {}} dismissLabel="Hide import notice" />,
    );
    expect(screen.getByRole('button', { name: 'Hide import notice' })).toBeInTheDocument();
  });

  it('actions and dismiss work with Enter and Space in a logical order', async () => {
    const review = vi.fn();
    const dismiss = vi.fn();
    const { user } = renderBrainbase(
      <Banner
        state="warning"
        title="Sources need attention"
        actions={[{ label: 'Review sources', onClick: review }]}
        onDismiss={dismiss}
      >
        Two sources failed to sync.
      </Banner>,
    );
    await expectNamedFocusOrder(user, ['Review sources', 'Dismiss: Sources need attention']);

    const reviewButton = screen.getByRole('button', { name: 'Review sources' });
    await expectKeyboardActivation(user, reviewButton, review, 'Enter');
    await expectKeyboardActivation(user, reviewButton, review, 'Space');

    const dismissButton = screen.getByRole('button', { name: 'Dismiss: Sources need attention' });
    await expectKeyboardActivation(user, dismissButton, dismiss, 'Enter');
    await expectKeyboardActivation(user, dismissButton, dismiss, 'Space');
  });
});
