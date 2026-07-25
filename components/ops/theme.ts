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
    pageBg:       '#07080B',
    panelBgSolid: '#0B0C10',
    menuBg:       '#14161B',
    sidebarBg:    'rgba(6,7,10,.97)',
    headerBg:     'rgba(6,7,10,.95)',
    accent:       '#8B5CF6',
    accentLight:  '#A78BFA',
    accentText:   '#C4B5FD',
    scrim:        'rgba(0,0,0,.45)',
  },
  light: {
    pageBg:       '#F5F6F8',
    panelBgSolid: '#FFFFFF',
    menuBg:       '#FFFFFF',
    sidebarBg:    'rgba(255,255,255,.98)',
    headerBg:     'rgba(255,255,255,.96)',
    accent:       '#7C3AED',
    accentLight:  '#7C3AED',
    accentText:   '#6D28D9',
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
