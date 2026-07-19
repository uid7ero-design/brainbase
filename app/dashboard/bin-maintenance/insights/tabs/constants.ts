import { DARK_TOKENS } from '@/components/dashboard/ui/tokens';

export const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

export const BIN_COLOR: Record<string, string> = {
  GENERAL_WASTE: 'rgba(148,163,184,0.7)',
  RECYCLING:     '#10b981',
  ORGANICS:      '#84cc16',
  BULK_WASTE:    '#F59E0B',
};

export const BIN_LABEL: Record<string, string> = {
  GENERAL_WASTE: 'General Waste',
  RECYCLING:     'Recycling',
  ORGANICS:      'Organics',
  BULK_WASTE:    'Bulk Waste',
};

export const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CAT_COLORS = ['#A78BFA', '#10b981', '#F59E0B', '#60A5FA', '#EF4444', '#84cc16', '#F472B6', '#38BDF8'];

export const GRID = DARK_TOKENS.grid;
export const TICK = { fill: DARK_TOKENS.tick, fontSize: 11 };
export const TOOLTIP_STYLE = { ...DARK_TOKENS.tip, fontSize: 12 };

export const TARGET_PCT = 90;
