import { useTheme, type Theme } from '@/components/theme/ThemeProvider';

// Phase D2 — JS-accessible chart palette.
//
// SVG presentation attributes and chart libraries (recharts `stroke=`,
// `fill=`, tooltip `contentStyle`) cannot always resolve CSS custom
// properties, so charts read concrete colours from here instead. Every
// value mirrors a token in app/globals.css / styles/brainbase-tokens.css
// for the same theme (pinned by tests/containment/dashboardCommandD2.test.ts),
// so a chart and the surface around it cannot drift apart.
//
//   primary     — the single series / the thing being measured (accent)
//   secondary   — a second series of the same kind (lighter accent tint)
//   comparison  — prior period / target / benchmark (neutral, not a hue)
//   success · warning · danger · info — semantic series only (thresholds,
//                 good/bad trends); every series colour is ≥3:1 on --bg-surface
//   neutral     — de-emphasised marks, inactive categories
//   grid · axis — gridlines and tick labels
//   tooltip*    — tooltip surface, border and text
//
// No rainbow: categories that genuinely need distinct hues should use
// primary → secondary → comparison → neutral first.

export type ChartPalette = {
  primary: string;
  secondary: string;
  comparison: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  neutral: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
};

export const CHART_PALETTE: Record<Theme, ChartPalette> = {
  dark: {
    primary: '#9B7BFF',        // --brand-brainbase-accent
    secondary: '#C6B8FF',      // --purple-200
    comparison: '#8A8580',     // --text-muted
    success: '#3fbf7f',        // --bb-success-dot
    warning: '#eaa53a',        // --bb-warning-dot
    danger: '#f06a5e',         // --bb-error-dot
    info: '#22c7e8',           // --bb-info-dot (--bb-cyan-400)
    neutral: '#6F6B66',        // --text-subtle
    grid: 'rgba(243, 238, 230, 0.08)', // --border
    axis: '#8A8580',           // --text-muted
    tooltipBg: '#1B1B1E',      // --bg-overlay
    tooltipBorder: 'rgba(243, 238, 230, 0.08)',
    tooltipText: '#F3EEE6',    // --text-primary
  },
  light: {
    primary: '#6D4CD6',        // --brand-brainbase-accent
    secondary: '#8B70DE',      // accent tint (no light token; ≥3:1 on white)
    comparison: '#8A8580',     // --text-subtle
    success: '#1f9d5c',        // --bb-success-dot
    warning: '#87500a',        // --bb-warning-fg (the light dot is <3:1 on white)
    danger: '#d92d20',         // --bb-error-dot
    info: '#0987a7',           // --bb-info-dot (--bb-cyan-600)
    neutral: '#8A8580',        // --text-subtle
    grid: 'rgba(21, 23, 27, 0.10)', // --border
    axis: '#67625C',           // --text-muted
    tooltipBg: '#FFFFFF',      // --bg-overlay
    tooltipBorder: 'rgba(21, 23, 27, 0.10)',
    tooltipText: '#15171B',    // --text-primary
  },
};

export function chartPalette(theme: Theme): ChartPalette {
  return CHART_PALETTE[theme];
}

/** The palette for the current app theme (re-renders on theme change). */
export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return CHART_PALETTE[theme];
}
