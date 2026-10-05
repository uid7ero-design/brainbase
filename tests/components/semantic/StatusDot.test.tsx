import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { StatusDot, SEMANTIC_STATES } from '@/components/ui/semantic';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectDecorative } from '../../a11y/accessibility';
import { expectNotLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';
import { expectSemanticState } from '../../a11y/semantic-state';

describe('StatusDot', () => {
  it.each(SEMANTIC_STATES)('has no axe violations in state "%s" (both themes)', async state => {
    for (const theme of ['light', 'dark'] as const) {
      const { container, unmount } = renderBrainbase(<StatusDot state={state} />, { theme });
      await expectNoAxeViolations(container);
      unmount();
    }
  });

  it('names its state in visible text', () => {
    const { container } = renderBrainbase(<StatusDot state="syncing" label="Syncing sources" />);
    expectSemanticState(container.querySelector('[data-state]')!, 'syncing', 'Syncing sources');
    expect(screen.getByText('Syncing sources')).toBeVisible();
  });

  it('falls back to the standard state label', () => {
    const { container } = renderBrainbase(<StatusDot state="inactive" />);
    expectSemanticState(container.querySelector('[data-state]')!, 'inactive', 'Inactive');
  });

  it('hides the decorative dot from screen readers', () => {
    const { container } = renderBrainbase(<StatusDot state="active" />);
    expectDecorative(container.querySelector('[data-shape]')!);
  });

  it('is not a live region by default', () => {
    renderBrainbase(<StatusDot state="success" label="Connected" />);
    expectNotLiveRegion(screen.getByText('Connected'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces politely when opted in', () => {
    renderBrainbase(<StatusDot state="syncing" label="Syncing" announce />);
    expectPoliteLiveRegion(screen.getByRole('status'));
  });

  it('gives every state its own dot shape, not only its own colour', () => {
    const shapes = SEMANTIC_STATES.map(state => {
      const { container, unmount } = renderBrainbase(<StatusDot state={state} />);
      const shape = container.querySelector('[data-shape]')!.getAttribute('data-shape');
      unmount();
      return shape;
    });
    expect(new Set(shapes).size).toBe(SEMANTIC_STATES.length);
  });
});
