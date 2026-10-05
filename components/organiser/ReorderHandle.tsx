'use client';

import type { ReorderMove } from '@/lib/organiser/keyboardReorder';

// Phase D.4.7F — extracted from the group/item/subitem drag-handle markup
// that previously lived inline (twice) in app/organiser/page.tsx, so the
// pointer wiring (draggable/onDragStart, title, aria-label) and the new
// keyboard wiring (ArrowUp/ArrowDown/Home/End) exist in exactly one place,
// and so this ONE new keyboard surface can get real rendered
// (jsdom + jest-axe) coverage — see tests/components/organiser/
// ReorderHandle.test.tsx — something app/organiser/page.tsx itself has no
// harness for (it remains containment-tested, per this repo's own
// established convention for that file).
//
// This component owns NO reorder logic of its own: `onMove` is called
// with the raw key intent (up/down/first/last) and the caller (which
// knows the current scope's id list) decides via
// lib/organiser/keyboardReorder.ts's moveInOrderedList whether that's a
// real move or a boundary no-op, then feeds a real move into the exact
// same reorderGroups/reorderTopLevelItems/reorderSubitems functions
// pointer drag already uses. preventDefault() is called here for all
// four handled keys regardless of outcome, so the page never scrolls as
// a side effect of a boundary press.

export type ReorderHandleSize = 'group' | 'item';

// Literal coordinates from the original inline markup (GroupSection's
// group handle / ItemRow's item+subitem handle in app/organiser/page.tsx
// before this extraction) — kept as exact per-variant literals, not
// derived from a shared ratio, because the two variants' spacing is not
// proportional to each other (group: 2.5/7/11.5 over a 14-tall box;
// item: 2/6/10 over a 12-tall box — a ratio formula would silently shift
// the item dots off their original pixel positions).
const ICONS: Record<ReorderHandleSize, {
  wrapperWidth: number; wrapperHeight: number;
  svgWidth: number; svgHeight: number; viewBox: string; r: number;
  cx: [number, number]; cy: [number, number, number];
}> = {
  group: { wrapperWidth: 14, wrapperHeight: 18, svgWidth: 10, svgHeight: 14, viewBox: '0 0 10 14', r: 1.4, cx: [2.5, 7.5], cy: [2.5, 7, 11.5] },
  item: { wrapperWidth: 12, wrapperHeight: 16, svgWidth: 8, svgHeight: 12, viewBox: '0 0 8 12', r: 1.2, cx: [2, 6], cy: [2, 6, 10] },
};

function GripIcon({ size }: { size: ReorderHandleSize }) {
  const { svgWidth, svgHeight, viewBox, r, cx, cy } = ICONS[size];
  return (
    <svg width={svgWidth} height={svgHeight} viewBox={viewBox} fill="currentColor" aria-hidden="true">
      <circle cx={cx[0]} cy={cy[0]} r={r} /><circle cx={cx[1]} cy={cy[0]} r={r} />
      <circle cx={cx[0]} cy={cy[1]} r={r} /><circle cx={cx[1]} cy={cy[1]} r={r} />
      <circle cx={cx[0]} cy={cy[2]} r={r} /><circle cx={cx[1]} cy={cy[2]} r={r} />
    </svg>
  );
}

export function ReorderHandle({
  size, title, ariaLabel, onDragStart, onMove,
}: {
  /** Selects the pre-existing pixel dimensions: 'group' = 14x18/10x14 icon, 'item' = 12x16/8x12 icon (used for both top-level items and subitems). */
  size: ReorderHandleSize;
  title: string;
  ariaLabel: string;
  onDragStart: (e: React.DragEvent) => void;
  /** Called for ArrowUp/ArrowDown/Home/End with the raw move intent — the caller decides whether it's a real move or a no-op. */
  onMove: (move: ReorderMove) => void;
}) {
  const { wrapperWidth, wrapperHeight } = ICONS[size];
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onKeyDown={e => {
        let move: ReorderMove | null = null;
        if (e.key === 'ArrowUp') move = 'up';
        else if (e.key === 'ArrowDown') move = 'down';
        else if (e.key === 'Home') move = 'first';
        else if (e.key === 'End') move = 'last';
        if (move === null) return;
        e.preventDefault();
        onMove(move);
      }}
      title={title}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      style={{ width: wrapperWidth, height: wrapperHeight, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', color: 'var(--text-muted)' }}
    >
      <GripIcon size={size} />
    </span>
  );
}
