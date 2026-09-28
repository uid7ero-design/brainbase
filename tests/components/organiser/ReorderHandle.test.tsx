import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ReorderHandle } from '@/components/organiser/ReorderHandle';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase D.4.7F — ReorderHandle rendered for real (jsdom + jest-axe), the
// one new keyboard surface this milestone adds. It owns no reorder logic
// itself (see its own header comment) — this only proves the handle is a
// real, accessible, keyboard-operable control: ArrowUp/ArrowDown/Home/End
// call onMove with the right intent, every handled key calls
// preventDefault, pointer wiring (draggable/onDragStart) is untouched,
// it has a real accessible name, and it produces zero axe violations.

describe('ReorderHandle', () => {
  it('has an accessible name and is a real focusable button', () => {
    renderBrainbase(<ReorderHandle size="group" title="Drag to reorder" ariaLabel="Reorder group" onDragStart={() => {}} onMove={() => {}} />);
    const handle = screen.getByRole('button', { name: 'Reorder group' });
    expect(handle).toHaveAttribute('tabIndex', '0');
    expect(handle).toHaveAttribute('title', 'Drag to reorder');
  });

  it('preserves the item variant\'s own title/aria-label wording', () => {
    renderBrainbase(<ReorderHandle size="item" title="Drag to reorder item" ariaLabel="Reorder item" onDragStart={() => {}} onMove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Reorder item' })).toHaveAttribute('title', 'Drag to reorder item');
  });

  it.each([
    ['{ArrowUp}', 'up'],
    ['{ArrowDown}', 'down'],
    ['{Home}', 'first'],
    ['{End}', 'last'],
  ] as const)('%s calls onMove with "%s"', async (key, expectedMove) => {
    const onMove = vi.fn();
    const { user } = renderBrainbase(<ReorderHandle size="item" title="Drag to reorder item" ariaLabel="Reorder item" onDragStart={() => {}} onMove={onMove} />);
    screen.getByRole('button', { name: 'Reorder item' }).focus();
    await user.keyboard(key);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(expectedMove);
  });

  it('does not call onMove for an unrelated key', async () => {
    const onMove = vi.fn();
    const { user } = renderBrainbase(<ReorderHandle size="item" title="Drag to reorder item" ariaLabel="Reorder item" onDragStart={() => {}} onMove={onMove} />);
    screen.getByRole('button', { name: 'Reorder item' }).focus();
    await user.keyboard('{Enter}');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('calls preventDefault on ArrowDown so the page never scrolls as a side effect', () => {
    renderBrainbase(<ReorderHandle size="item" title="Drag to reorder item" ariaLabel="Reorder item" onDragStart={() => {}} onMove={() => {}} />);
    const handle = screen.getByRole('button', { name: 'Reorder item' });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('still fires onDragStart for pointer drag — the keyboard wiring did not replace it', () => {
    const onDragStart = vi.fn();
    renderBrainbase(<ReorderHandle size="group" title="Drag to reorder" ariaLabel="Reorder group" onDragStart={onDragStart} onMove={() => {}} />);
    const handle = screen.getByRole('button', { name: 'Reorder group' });
    expect(handle).toHaveAttribute('draggable');
    const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
    handle.dispatchEvent(event);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it.each(['group', 'item'] as const)('%s variant has no axe violations', async size => {
    const { container } = renderBrainbase(
      <ReorderHandle size={size} title="Drag to reorder" ariaLabel={size === 'group' ? 'Reorder group' : 'Reorder item'} onDragStart={() => {}} onMove={() => {}} />,
    );
    await expectNoAxeViolations(container);
  });
});
