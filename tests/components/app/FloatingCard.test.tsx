import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { FloatingCard } from '@/components/cards/FloatingCard';

// Authenticated visual-completion pass (P3 follow-up) — Helena's
// action-feedback card, stacked bottom-left on every /dashboard/** and
// /organiser page by HlnaAssistantWrapper. Converged from glass + white-alpha
// text to theme tokens; the timing/dismiss contract is unchanged.

const CARD = { id: 'k1', type: 'Action', time: '09:14', title: 'Task created', sub: 'Follow up with depot supervisor' };

// The card root is the only element carrying an inline width.
const cardEl = (c: Element) => c.querySelector<HTMLElement>('[style*="width"]');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe.each(['light', 'dark'] as const)('FloatingCard (%s)', theme => {
  it('renders the card content with a named dismiss control and no axe violations', async () => {
    vi.useRealTimers();
    const { container } = renderBrainbase(<FloatingCard card={CARD} onDismiss={() => {}} />, { theme });
    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByText('09:14')).toBeTruthy();
    expect(screen.getByText('Task created')).toBeTruthy();
    expect(screen.getByText('Follow up with depot supervisor')).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Dismiss' });
    expect(close.getAttribute('type')).toBe('button');
    await expectNoAxeViolations(container);
  });

  it('falls back to card.content and keeps the revenue width variant', () => {
    const { container } = renderBrainbase(
      <FloatingCard card={{ ...CARD, sub: undefined, content: 'Body text', variant: 'revenue' }} onDismiss={() => {}} />, { theme });
    expect(screen.getByText('Body text')).toBeTruthy();
    expect(cardEl(container)!.style.width).toBe('290px');
  });

  it('auto-fades at 5.5s and dismisses at 6.2s', () => {
    const onDismiss = vi.fn();
    const { container } = renderBrainbase(<FloatingCard card={CARD} onDismiss={onDismiss} />, { theme });
    const el = () => cardEl(container);
    expect(el()!.style.width).toBe('240px');
    expect(el()!.style.opacity).toBe('1');
    act(() => { vi.advanceTimersByTime(5500); });
    expect(el()!.style.opacity).toBe('0');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(el()).toBeNull();
  });

  it('dismiss button fades immediately and removes after 400ms', () => {
    const onDismiss = vi.fn();
    const { container } = renderBrainbase(<FloatingCard card={CARD} onDismiss={onDismiss} />, { theme });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(cardEl(container)!.style.opacity).toBe('0');
    act(() => { vi.advanceTimersByTime(399); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(cardEl(container)).toBeNull();
  });
});
