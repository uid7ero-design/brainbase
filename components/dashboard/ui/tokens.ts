// Design tokens for the Brainbase dashboard component system.
//
// Authenticated visual-completion pass: every value here is a theme token
// (a CSS custom property from app/globals.css), so the municipal dashboard
// shell, its cards and every module page follow the app's light/dark theme
// instead of carrying a hardcoded dark (or light) palette. Nothing in this
// file resolves to a concrete colour.
//
// These strings are for HTML styles. SVG chart marks (recharts `fill=`,
// `stroke=`, tick `fill`) read concrete colours from useDashboardChart()
// in ./chartTheme (which wraps components/ui/app/chartPalette), because
// SVG presentation attributes cannot always resolve custom properties.

/** A translucent tint of any colour (token or hex) — for fills and hairlines. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export type Tone = 'danger' | 'warning' | 'success' | 'info' | 'inactive';

/** Semantic status colours: `fg` meets 4.5:1 as text on every surface. */
export const TONE: Record<Tone, { fg: string; muted: string; border: string }> = {
  danger:   { fg: 'var(--status-danger)',   muted: 'var(--status-danger-muted)',   border: 'var(--status-danger-border)' },
  warning:  { fg: 'var(--status-warning)',  muted: 'var(--status-warning-muted)',  border: 'var(--status-warning-border)' },
  success:  { fg: 'var(--status-success)',  muted: 'var(--status-success-muted)',  border: 'var(--status-success-border)' },
  info:     { fg: 'var(--status-info)',     muted: 'var(--status-info-muted)',     border: 'var(--status-info-border)' },
  inactive: { fg: 'var(--status-inactive)', muted: 'var(--status-inactive-muted)', border: 'var(--border)' },
};

export const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'success' } as const satisfies Record<'High' | 'Medium' | 'Low', Tone>;

export const COLORS = {
  riskRed:    TONE.danger.fg,
  watchAmber: TONE.warning.fg,
  okGreen:    TONE.success.fg,
  // neutral (kept for API compatibility; theme-following)
  white:      'var(--text-primary)',
  offWhite:   'var(--text-secondary)',
} as const;

export const PRIORITY_COLORS = {
  High:   TONE.danger.fg,
  Medium: TONE.warning.fg,
  Low:    TONE.success.fg,
} as const;

export const STATUS_COLORS = {
  risk:   TONE.danger.fg,
  watch:  TONE.warning.fg,
  normal: null, // falls back to accentColor
} as const;

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  '3xl': 32,
} as const;

export const TYPOGRAPHY = {
  label:   { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  caption: { fontSize: 11, fontWeight: 400 },
  body:    { fontSize: 12.5, fontWeight: 400 },
  bodyMd:  { fontSize: 13, fontWeight: 400 },
  kpiVal:  { fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' as const },
  headXs:  { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  headSm:  { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
} as const;

// Shared theme token shape (kept for API compatibility).
export interface ThemeTokens {
  bg:         string;
  card:       React.CSSProperties;
  t1:         string;
  t2:         string;
  t3:         string;
  bdr:        string;
  rbdr:       string;
  ralt:       string;
  rhead:      string;
  grid:       string;
  tick:       string;
  tip:        React.CSSProperties;
  sub:        string;
  inp:        string;
  barMuted:   string;
  priorFy:    string;
  budgetLine: string;
}

/** The one dashboard token set — theme-following, for HTML styles. */
export const DASHBOARD_TOKENS: ThemeTokens = {
  bg:         'var(--bg-base)',
  card:       { background: 'var(--bg-surface)', border: '1px solid var(--border)' },
  t1:         'var(--text-primary)',
  t2:         'var(--text-secondary)',
  t3:         'var(--text-muted)',
  bdr:        'var(--border)',
  rbdr:       'var(--border-light)',
  ralt:       'var(--bg-sunken)',
  rhead:      'var(--bg-sunken)',
  grid:       'var(--border)',
  tick:       'var(--text-muted)',
  tip:        { background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', boxShadow: 'var(--shadow-popover)' },
  sub:        'var(--bg-sunken)',
  inp:        'var(--bg-raised)',
  barMuted:   'var(--border-strong)',
  priorFy:    'var(--text-subtle)',
  budgetLine: 'var(--text-muted)',
};

/**
 * @deprecated Both names resolve to the same theme-following set; the
 * light/dark split now lives in app/globals.css (data-theme), not here.
 */
export const LIGHT_TOKENS: ThemeTokens = DASHBOARD_TOKENS;
/** @deprecated See LIGHT_TOKENS. */
export const DARK_TOKENS: ThemeTokens = DASHBOARD_TOKENS;

/**
 * Kept for API compatibility. The `theme` argument no longer selects a
 * palette — the tokens follow the app theme (<html data-theme>).
 */
export function getTheme(_theme?: 'light' | 'dark'): ThemeTokens {
  return DASHBOARD_TOKENS;
}

export function statusColor(
  status: 'risk' | 'watch' | 'normal' | undefined,
  alert: boolean | undefined,
  accentColor: string,
): string {
  if (alert || status === 'risk') return COLORS.riskRed;
  if (status === 'watch') return COLORS.watchAmber;
  return accentColor;
}

export function priorityBorderColor(priority: 'High' | 'Medium' | 'Low'): string {
  return PRIORITY_COLORS[priority];
}
