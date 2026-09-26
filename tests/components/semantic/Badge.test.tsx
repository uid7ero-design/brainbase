import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Badge, SEMANTIC_STATES } from '@/components/ui/semantic';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectDecorative } from '../../a11y/accessibility';
import { expectNotLiveRegion, expectPoliteLiveRegion } from '../../a11y/live-region';
import { expectSemanticState } from '../../a11y/semantic-state';

describe('Badge', () => {
  it.each(SEMANTIC_STATES)('has no axe violations in state "%s"', async state => {
    const { container } = renderBrainbase(<Badge state={state} />);
    await expectNoAxeViolations(container);
  });

  it.each([
    ['success', 'Connected'],
    ['syncing', 'Synced'],
    ['active', 'In development'],
    ['inactive', 'Read-only'],
  ] as const)('shows %s state with visible text "%s"', (state, text) => {
    const { container } = renderBrainbase(<Badge state={state}>{text}</Badge>);
    expectSemanticState(container.querySelector('[data-state]')!, state, text);
  });

  it('hides the decorative dot', () => {
    const { container } = renderBrainbase(<Badge state="success">Connected</Badge>);
    expectDecorative(container.querySelector('[data-shape]')!);
  });

  it('can drop the dot entirely while keeping the text', () => {
    const { container } = renderBrainbase(<Badge state="info" dot={false}>Beta</Badge>);
    expect(container.querySelector('[data-shape]')).toBeNull();
    expect(screen.getByText('Beta')).toBeVisible();
  });

  it('is not a live region when static', () => {
    renderBrainbase(<Badge state="active">In development</Badge>);
    expectNotLiveRegion(screen.getByText('In development'));
  });

  it('a dynamic syncing badge announces politely', () => {
    renderBrainbase(<Badge state="syncing" announce>Syncing</Badge>);
    expectPoliteLiveRegion(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveTextContent('Syncing');
  });
});
