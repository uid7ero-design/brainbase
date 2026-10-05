import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Badge, Button, Panel } from '@/components/ui/app';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectNotLiveRegion } from '../../a11y/live-region';

describe('App Panel (Phase A primitive)', () => {
  it.each(['light', 'dark'] as const)('has no axe violations with title, actions and status (%s)', async theme => {
    const { container } = renderBrainbase(
      <main>
        <h1>Invoices</h1>
        <Panel title="Outstanding" actions={<Button size="sm">Export</Button>}>
          <Badge state="warning">3 overdue</Badge>
        </Panel>
      </main>,
      { theme },
    );
    await expectNoAxeViolations(container);
  });

  it('is a labelled region when titled, at the heading level the page needs', () => {
    renderBrainbase(
      <Panel title="Line items" titleAs="h3">
        body
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Line items' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Line items' })).toBeInTheDocument();
  });

  it('is a plain container (not a landmark) without a title', () => {
    const { container } = renderBrainbase(<Panel>body</Panel>);
    expect(screen.queryByRole('region')).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });

  it('supports edge-to-edge bodies for tables', () => {
    const { container } = renderBrainbase(
      <Panel title="Registrations" padding="none">
        <table>
          <tbody>
            <tr>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </Panel>,
    );
    expect(container.querySelector('[data-padding="none"] table')).not.toBeNull();
  });

  it('static status inside a panel is not a live region', () => {
    renderBrainbase(
      <Panel title="Sync">
        <Badge state="syncing">Syncing</Badge>
      </Panel>,
    );
    expectNotLiveRegion(screen.getByText('Syncing'));
  });
});
