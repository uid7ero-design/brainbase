import type { ChartPalette } from '@/components/ui/app/chartPalette';

// Authenticated visual-completion pass: the insights surface follows the app
// theme. Stream encodings are palette KEYS (resolved through
// useDashboardChart().palette at render time) so the four streams stay
// distinct and legible in light AND dark; chart chrome (grid, ticks,
// tooltip) comes from useDashboardChart() in each tab.

export type SeriesKey = 'primary' | 'secondary' | 'comparison' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Stream → palette key (general = neutral, recycling = green, organics = cyan, bulk = amber). */
export const BIN_TONE: Record<string, SeriesKey> = {
  GENERAL_WASTE: 'neutral',
  RECYCLING:     'success',
  ORGANICS:      'info',
  BULK_WASTE:    'warning',
};

/** Concrete, theme-aware colour for a stream (unknown streams read neutral). */
export function binColor(palette: ChartPalette, key: string): string {
  return palette[BIN_TONE[key] ?? 'neutral'];
}

export const BIN_LABEL: Record<string, string> = {
  GENERAL_WASTE: 'General Waste',
  RECYCLING:     'Recycling',
  ORGANICS:      'Organics',
  BULK_WASTE:    'Bulk Waste',
};

export const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Compliance % → semantic tone (same thresholds as before). */
export function pctTone(pct: number): 'success' | 'warning' | 'danger' {
  return pct >= TARGET_PCT ? 'success' : pct >= 70 ? 'warning' : 'danger';
}

export const TARGET_PCT = 90;

/** Informational notice band used above several tabs. */
export const INFO_NOTE = {
  background: 'var(--status-info-muted)',
  border: '1px solid var(--status-info-border)',
  borderRadius: 'var(--radius-lg)',
  padding: '10px 14px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  marginBottom: 20,
} as const;

/** Thin progress track + table header label, shared by the tabs. */
export const TRACK = { height: 4, borderRadius: 2, background: 'var(--bg-sunken)', overflow: 'hidden' } as const;
export const TH_LABEL = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--text-secondary)' };
export const ROW_BORDER = { borderBottom: '1px solid var(--border)' };
