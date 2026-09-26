import { configureAxe } from 'jest-axe';
import { expect } from 'vitest';

// Components are rendered in isolation, outside any page landmarks, so the
// page-level "region" rule does not apply. Colour contrast cannot be
// computed in jsdom; it is checked in the browser review instead.
const axe = configureAxe({
  rules: {
    region: { enabled: false },
    'color-contrast': { enabled: false },
  },
});

/** Run axe over a rendered subtree and fail with the violation report. */
export async function expectNoAxeViolations(container: Element) {
  const results = await axe(container);
  expect(results).toHaveNoViolations();
}
