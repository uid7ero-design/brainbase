'use client';

import type { CSSProperties } from 'react';
import { useChartPalette, type ChartPalette } from '@/components/ui/app/chartPalette';

// Chart chrome for the municipal dashboards (authenticated visual-completion
// pass). Recharts draws SVG, whose presentation attributes cannot always
// resolve CSS custom properties, so every mark, axis, grid line and tooltip
// reads a concrete colour from the theme-aware chart palette
// (components/ui/app/chartPalette.ts). The palette mirrors the app tokens
// for the active theme, so a chart and the surface around it never drift,
// and every series colour is at least 3:1 on the panel in BOTH themes.

export type DashboardChart = {
  palette: ChartPalette;
  /** CartesianGrid stroke. */
  grid: string;
  /** XAxis/YAxis `tick` prop. */
  tick: { fill: string; fontSize: number };
  /** Spread onto <Tooltip>: themed surface, border and text. */
  tooltip: {
    contentStyle: CSSProperties;
    labelStyle: CSSProperties;
    itemStyle: CSSProperties;
    cursor: { fill: string };
  };
  /** Legend text style. */
  legend: CSSProperties;
  /**
   * Categorical series in a fixed order for charts whose categories have no
   * inherent meaning (pie slices, stacked services). Semantic series
   * (good/bad, severity) should use palette.success/warning/danger instead.
   */
  series: string[];
};

export function dashboardChart(p: ChartPalette): DashboardChart {
  return {
    palette: p,
    grid: p.grid,
    tick: { fill: p.axis, fontSize: 11 },
    tooltip: {
      contentStyle: {
        background: p.tooltipBg,
        border: `1px solid ${p.tooltipBorder}`,
        borderRadius: 6,
        color: p.tooltipText,
        fontSize: 12,
        boxShadow: 'var(--shadow-popover)',
      },
      labelStyle: { color: p.tooltipText, fontWeight: 600 },
      itemStyle: { color: p.tooltipText },
      cursor: { fill: p.grid },
    },
    legend: { fontSize: 11, color: p.axis },
    series: [p.primary, p.info, p.success, p.warning, p.danger, p.secondary, p.comparison, p.neutral],
  };
}

/** Chart chrome + palette for the current app theme. */
export function useDashboardChart(): DashboardChart {
  return dashboardChart(useChartPalette());
}
