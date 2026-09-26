import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export type BrainbaseTheme = 'light' | 'dark';

/**
 * Render a BrainBase component the way the public site mounts it: inside a
 * `.bb-public` scope with <html data-theme> set. Returns RTL's result plus a
 * `user` from userEvent.setup() for keyboard/pointer interaction.
 */
export function renderBrainbase(
  ui: ReactElement,
  { theme = 'dark', ...options }: { theme?: BrainbaseTheme } & Omit<RenderOptions, 'wrapper'> = {},
) {
  document.documentElement.setAttribute('data-theme', theme);
  const user = userEvent.setup();
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => <div className="bb-public">{children}</div>,
  });
  return { user, ...result };
}
