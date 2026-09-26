import { expect } from 'vitest';
import type { SemanticState } from '@/components/ui/semantic';

/**
 * The element carries data-state={state} and names that state in visible,
 * non-hidden text — so colour is never the only signal.
 */
export function expectSemanticState(element: Element, state: SemanticState, visibleText?: string | RegExp) {
  expect(element).toHaveAttribute('data-state', state);

  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"], .bb-visually-hidden').forEach(n => n.remove());
  const text = clone.textContent?.trim() ?? '';
  expect(text, 'state must be named in visible text').not.toBe('');
  if (visibleText !== undefined) {
    expect(text).toMatch(visibleText);
  }
}
