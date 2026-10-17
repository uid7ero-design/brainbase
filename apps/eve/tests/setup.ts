import '@testing-library/jest-dom/vitest';
import { afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// Vitest runs without globals, so React Testing Library does not register
// its own afterEach cleanup; do it here so each test starts from an empty
// document.
afterEach(() => cleanup());

// next/font needs the Next compiler; the shell components only read the
// resulting className, so a plain stub is enough for rendered tests.
vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'font-inter', variable: '--font-sans' }),
}));
