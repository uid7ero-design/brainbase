import type { UserEvent } from '@testing-library/user-event';
import { expect, type Mock } from 'vitest';

/** Tabbing from the start of the document visits exactly these elements, in order. */
export async function expectFocusOrder(user: UserEvent, elements: Element[]) {
  (document.activeElement as HTMLElement | null)?.blur();
  for (const element of elements) {
    await user.tab();
    expect(document.activeElement).toBe(element);
  }
}

/** Tabbing from the start of the document visits controls with these accessible names, in order. */
export async function expectNamedFocusOrder(user: UserEvent, names: (string | RegExp)[]) {
  (document.activeElement as HTMLElement | null)?.blur();
  for (const name of names) {
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName(name);
  }
}

/** Focusing `element` and pressing `key` calls `handler` exactly once. */
export async function expectKeyboardActivation(
  user: UserEvent,
  element: HTMLElement,
  handler: Mock,
  key: 'Enter' | 'Space',
) {
  handler.mockClear();
  element.focus();
  expect(element).toHaveFocus();
  await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');
  expect(handler).toHaveBeenCalledTimes(1);
}
