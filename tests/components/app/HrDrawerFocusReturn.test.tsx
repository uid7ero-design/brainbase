import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { useHrDrawerFocusReturn } from '@/app/people/_components/useHrDrawerFocusReturn';

function View({ selected, ready, visible = true }: { selected: string | null; ready: boolean; visible?: boolean }) {
  useHrDrawerFocusReturn(selected, ready);
  return <><button data-hr-register-refresh disabled={!ready}>Refresh</button><button>Other control</button>
    {ready && visible && <button data-hr-person-id="Alex">Open Alex</button>}</>;
}
describe('focus after drawer close refresh', () => {
  it('waits for replacement rows, then focuses the selected person', () => {
    const view = renderBrainbase(<View selected="Alex" ready />);
    view.rerender(<View selected={null} ready />);
    expect(document.activeElement).toBe(document.body);
    view.rerender(<View selected={null} ready={false} />);
    view.rerender(<View selected={null} ready />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Alex' }));
  });
  it('uses Refresh when the person disappears or the refreshed read fails', () => {
    const view = renderBrainbase(<View selected="Alex" ready />);
    view.rerender(<View selected={null} ready={false} />);
    view.rerender(<View selected={null} ready visible={false} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refresh' }));
  });
  it('does not steal focus from another control used during the refresh', () => {
    const view = renderBrainbase(<View selected="Alex" ready />);
    view.rerender(<View selected={null} ready={false} />);
    screen.getByRole('button', { name: 'Other control' }).focus();
    view.rerender(<View selected={null} ready />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Other control' }));
  });
  it('cancels pending focus restoration when another drawer opens', () => {
    const view = renderBrainbase(<View selected="Alex" ready />);
    view.rerender(<View selected={null} ready={false} />);
    view.rerender(<View selected="Morgan" ready />);
    expect(document.activeElement).toBe(document.body);
  });
});
