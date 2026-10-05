import { expect } from 'vitest';

const LIVE_ROLES = ['status', 'alert', 'log', 'marquee', 'timer'];

/** Routine update: role="status" / aria-live="polite". */
export function expectPoliteLiveRegion(element: Element) {
  expect(element.getAttribute('aria-live')).toBe('polite');
  expect(element.getAttribute('role')).toBe('status');
}

/** Critical failure: role="alert" / aria-live="assertive". */
export function expectAssertiveLiveRegion(element: Element) {
  expect(element.getAttribute('aria-live')).toBe('assertive');
  expect(element.getAttribute('role')).toBe('alert');
}

/** Static content: neither the element nor any ancestor is a live region. */
export function expectNotLiveRegion(element: Element) {
  let node: Element | null = element;
  while (node) {
    const live = node.getAttribute('aria-live');
    expect(live === null || live === 'off', `aria-live="${live}" on <${node.tagName.toLowerCase()}>`).toBe(true);
    expect(LIVE_ROLES).not.toContain(node.getAttribute('role'));
    node = node.parentElement;
  }
}
