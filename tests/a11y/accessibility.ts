import { expect } from 'vitest';

/** The element's computed accessible name. */
export function expectAccessibleName(element: Element, name: string | RegExp) {
  expect(element).toHaveAccessibleName(name);
}

/**
 * `element` is named by `label` through aria-labelledby: the id reference
 * exists and the computed accessible name is the label's text.
 */
export function expectLabelledBy(element: Element, label: Element) {
  expect(label.id, 'label element needs an id').not.toBe('');
  const ids = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/);
  expect(ids).toContain(label.id);
  expect(element).toHaveAccessibleName(label.textContent?.trim() ?? '');
}

/**
 * `element` is described by `description` through aria-describedby: the id
 * reference exists and the computed description is that text.
 */
export function expectDescribedBy(element: Element, description: Element) {
  expect(description.id, 'description element needs an id').not.toBe('');
  const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/);
  expect(ids).toContain(description.id);
  expect(element).toHaveAccessibleDescription(description.textContent?.trim() ?? '');
}

/**
 * A decorative element is hidden from assistive technology (itself or via
 * an ancestor) and cannot take focus.
 */
export function expectDecorative(element: Element) {
  const hidden = element.closest('[aria-hidden="true"]');
  expect(hidden, 'decorative element must be inside aria-hidden="true"').not.toBeNull();
  expect(element.matches('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toBe(false);
  if (element instanceof SVGElement) {
    expect(element.getAttribute('focusable')).toBe('false');
  }
}
