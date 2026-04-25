// Design tokens for the Brainbase dashboard component system

export const COLORS = {
  riskRed:    '#ef4444',
  watchAmber: '#f59e0b',
  okGreen:    '#10b981',
  // neutral
  white:      '#ffffff',
  offWhite:   '#e5e7eb',
} as const;

export const PRIORITY_COLORS = {
  High:   '#ef4444',
  Medium: '#f59e0b',
  Low:    '#10b981',
} as const;

export const STATUS_COLORS = {
  risk:   '#ef4444',
  watch:  '#f59e0b',
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
  label:   { fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  caption: { fontSize: 11, fontWeight: 400 },
  body:    { fontSize: 12.5, fontWeight: 400 },
  bodyMd:  { fontSize: 13, fontWeight: 400 },
  kpiVal:  { fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 },
  headXs:  { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  headSm:  { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
} as const;

// Shared theme token shapes — mirrors DashboardShell's `th` object
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

export const LIGHT_TOKENS: ThemeTokens = {
  bg:         '#f1f5f9',
  card:       { background: '#fff',                        border: '1.5px solid #d1d5db' },
  t1:         '#0f172a',
  t2:         '#475569',
  t3:         '#94a3b8',
  bdr:        '#d1d5db',
  rbdr:       '#e2e8f0',
  ralt:       '#fafafa',
  rhead:      '#f8fafc',
  grid:       '#f1f5f9',
  tick:       '#94a3b8',
  tip:        { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 },
  sub:        '#f1f5f9',
  inp:        '#fff',
  barMuted:   '#e2e8f0',
  priorFy:    '#cbd5e1',
  budgetLine: '#94a3b8',
};

export const DARK_TOKENS: ThemeTokens = {
  bg:         '#0f0f0f',
  card:       { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
  t1:         '#e5e7eb',
  t2:         'rgba(255,255,255,0.5)',
  t3:         'rgba(255,255,255,0.35)',
  bdr:        'rgba(255,255,255,0.08)',
  rbdr:       'rgba(255,255,255,0.05)',
  ralt:       'rgba(255,255,255,0.02)',
  rhead:      'rgba(255,255,255,0.06)',
  grid:       'rgba(255,255,255,0.05)',
  tick:       'rgba(255,255,255,0.4)',
  tip:        { background: '#1a1a2e', border: 'none', borderRadius: 8 },
  sub:        'rgba(255,255,255,0.04)',
  inp:        'rgba(255,255,255,0.06)',
  barMuted:   'rgba(255,255,255,0.15)',
  priorFy:    'rgba(255,255,255,0.2)',
  budgetLine: 'rgba(255,255,255,0.3)',
};

export function getTheme(theme: 'light' | 'dark'): ThemeTokens {
  return theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
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
