'use client';
import { useTheme, type Theme } from '@/components/theme/ThemeProvider';

/**
 * Transitional compatibility helpers for legacy Ops consumers.
 *
 * New components should prefer explicit BrainBase semantic tokens instead of
 * encoding hierarchy as arbitrary alpha values. These remain API-stable while
 * existing Ops / Organiser surfaces migrate incrementally.
 */
export function ink(theme: Theme, alpha: number): string {
  return theme === 'dark' ? 'rgba(255,255,255,' + alpha + ')' : 'rgba(15,17,23,' + alpha + ')';
}

/** @deprecated for new components; prefer semantic --bb-surface-* tokens. */
export function paper(theme: Theme, alpha: number): string {
  return theme === 'dark' ? 'rgba(7,8,11,' + alpha + ')' : 'rgba(255,255,255,' + alpha + ')';
}

/**
 * Ops keeps its public shape during the design-system migration, but the
 * palette now resolves through the canonical semantic CSS variables in
 * app/globals.css. Theme-specific values are owned by CSS, not duplicated here.
 */
const OPS_PALETTE: Record<Theme, {
  pageBg: string; panelBgSolid: string; menuBg: string; sidebarBg: string; headerBg: string;
  accent: string; accentLight: string; accentText: string; scrim: string;
}> = {
  dark: {
    pageBg:       'var(--bb-canvas)',
    panelBgSolid: 'var(--bb-surface-1)',
    menuBg:       'var(--bb-surface-3)',
    sidebarBg:    'var(--bb-shell-sidebar)',
    headerBg:     'var(--bb-shell-header)',
    accent:       'var(--bb-accent-500)',
    accentLight:  'var(--bb-accent-400)',
    accentText:   'var(--bb-accent-300)',
    scrim:        'var(--bb-scrim)',
  },
  light: {
    pageBg:       'var(--bb-canvas)',
    panelBgSolid: 'var(--bb-surface-1)',
    menuBg:       'var(--bb-surface-3)',
    sidebarBg:    'var(--bb-shell-sidebar)',
    headerBg:     'var(--bb-shell-header)',
    accent:       'var(--bb-accent-500)',
    accentLight:  'var(--bb-accent-400)',
    accentText:   'var(--bb-accent-300)',
    scrim:        'var(--bb-scrim)',
  },
};

export function useOpsTheme() {
  const { theme, toggleTheme } = useTheme();
  return {
    theme,
    toggleTheme,
    isDark: theme === 'dark',
    ink: (alpha: number) => ink(theme, alpha),
    paper: (alpha: number) => paper(theme, alpha),
    ...OPS_PALETTE[theme],
  };
}

export type OpsTheme = ReturnType<typeof useOpsTheme>;
