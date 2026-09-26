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
  bg:         '#f5f3ee',
  card:       { background: '#ffffff',                     border: '1px solid #ddd8cf' },
  t1:         '#15171b',
  t2:         '#5f5b55',
  t3:         '#8b867f',
  bdr:        '#ddd8cf',
  rbdr:       '#e7e2d9',
  ralt:       '#faf8f3',
  rhead:      '#f0ede7',
  grid:       '#ebe7df',
  tick:       '#8b867f',
  tip:        { background: '#fff', border: '1px solid #ddd8cf', borderRadius: 6 },
  sub:        '#f0ede7',
  inp:        '#fff',
  barMuted:   '#e3ded5',
  priorFy:    '#cbc5bb',
  budgetLine: '#8b867f',
};

export const DARK_TOKENS: ThemeTokens = {
  bg:         '#0b0b0c',
  card:       { background: '#131315', border: '1px solid #2a2927' },
  t1:         '#f3eee6',
  t2:         '#aaa6a0',
  t3:         '#77736e',
  bdr:        '#2a2927',
  rbdr:       '#22211f',
  ralt:       '#101012',
  rhead:      '#171719',
  grid:       '#22211f',
  tick:       '#8f8a83',
  tip:        { background: '#171719', border: '1px solid #2a2927', borderRadius: 6 },
  sub:        '#151517',
  inp:        '#151517',
  barMuted:   '#302f2c',
  priorFy:    '#3a3835',
  budgetLine: '#4a4742',
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
