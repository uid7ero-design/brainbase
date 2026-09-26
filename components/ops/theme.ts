'use client';
import { useTheme, type Theme } from '@/components/theme/ThemeProvider';

/**
 * "Ink" = foreground/text/icon colour at a given opacity, relative to the
 * theme's base surface. The whole ops/command UI already expresses its
 * entire text/border hierarchy as `rgba(255,255,255, alpha)` on a dark
 * background — same alpha scale, different base colour per theme, so a
 * dark-mode `rgba(255,255,255,.65)` becomes a light-mode `rgba(15,17,23,.65)`.
 */
export function ink(theme: Theme, alpha: number): string {
  return theme === 'dark' ? `rgba(255,255,255,${alpha})` : `rgba(15,17,23,${alpha})`;
}

/** "Paper" = background/surface colour at a given opacity (near-black in dark, near-white in light). */
export function paper(theme: Theme, alpha: number): string {
  return theme === 'dark' ? `rgba(7,8,11,${alpha})` : `rgba(255,255,255,${alpha})`;
}

const OPS_PALETTE: Record<Theme, {
  pageBg: string; panelBgSolid: string; menuBg: string; sidebarBg: string; headerBg: string;
  accent: string; accentLight: string; accentText: string; scrim: string;
}> = {
  dark: {
    pageBg:       '#0B0B0C',
    panelBgSolid: '#111113',
    menuBg:       '#151517',
    sidebarBg:    '#101012',
    headerBg:     '#0B0B0C',
    accent:       '#9B7BFF',
    accentLight:  '#B09AFF',
    accentText:   '#C6B8FF',
    scrim:        'rgba(0,0,0,.45)',
  },
  light: {
    pageBg:       '#F5F3EE',
    panelBgSolid: '#FFFFFF',
    menuBg:       '#FAF8F3',
    sidebarBg:    '#FAF8F3',
    headerBg:     '#F5F3EE',
    accent:       '#6D4CD6',
    accentLight:  '#6D4CD6',
    accentText:   '#5E3FC4',
    scrim:        'rgba(15,17,23,.35)',
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
