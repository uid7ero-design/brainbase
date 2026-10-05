import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import {
  Badge,
  Button,
  PageHeader,
  SlidePanel,
  StateMessage,
  TableContainer,
  TableStateRow,
  ToolbarSearch,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase C — shared authenticated work-surface primitives.

function WorkPage({ loading = false, rows = 2 }: { loading?: boolean; rows?: number }) {
  const [q, setQ] = useState('');
  return (
    <main>
      <PageHeader
        eyebrow={<a href="/crm">CRM</a>}
        title="Companies"
        meta={<Badge state="active">Live</Badge>}
        description="2 total"
        actions={<Button variant="primary">Add company</Button>}
      />
      <WorkToolbar count={q ? `${rows} results` : undefined} actions={<Button size="sm">Export</Button>}>
        <ToolbarSearch label="Search companies" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Filter by status" className={toolbarControlClassName}>
          <option>All</option>
        </select>
      </WorkToolbar>
      <TableContainer label="Companies">
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col" className={tableStyles.num}>Deals</th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={2} kind="loading">Loading companies…</TableStateRow>}
            {!loading && rows === 0 && <TableStateRow colSpan={2} kind="empty">No companies yet.</TableStateRow>}
            {!loading &&
              Array.from({ length: rows }, (_, i) => (
                <tr key={i}>
                  <td className={tableStyles.primary}>Company {i + 1}</td>
                  <td className={tableStyles.num}>{i + 3}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableContainer>
    </main>
  );
}

describe('Work surface composition', () => {
  it.each(['light', 'dark'] as const)('a representative list page has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<WorkPage />, { theme });
    await expectNoAxeViolations(container);
  });

  it.each(['light', 'dark'] as const)('the loading table state has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<WorkPage loading />, { theme });
    await expectNoAxeViolations(container);
  });

  it.each(['light', 'dark'] as const)('the empty table state has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<WorkPage rows={0} />, { theme });
    await expectNoAxeViolations(container);
  });
});

describe('PageHeader', () => {
  it('renders a single h1 with its context, metadata, description and actions', () => {
    renderBrainbase(<WorkPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CRM' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('2 total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add company' })).toBeInTheDocument();
  });

  it('can render a lower heading level for nested views', () => {
    renderBrainbase(<PageHeader title="Line items" titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Line items' })).toBeInTheDocument();
  });
});

describe('WorkToolbar', () => {
  it('the search box has a real accessible name, not a placeholder-only label', () => {
    renderBrainbase(<WorkPage />);
    const search = screen.getByRole('searchbox', { name: 'Search companies' });
    expect(search).toHaveAttribute('placeholder', 'Search…');
  });

  it('value and handlers stay with the caller; the result count is a polite status', async () => {
    const { user } = renderBrainbase(<WorkPage />);
    await user.type(screen.getByRole('searchbox', { name: 'Search companies' }), 'acme');
    expect(screen.getByRole('searchbox')).toHaveValue('acme');
    expect(screen.getByRole('status')).toHaveTextContent('2 results');
  });
});

describe('Table contract', () => {
  it('wraps the table in a named, keyboard-focusable scroll region', () => {
    renderBrainbase(<WorkPage />);
    const region = screen.getByRole('region', { name: 'Companies' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toHaveClass(tableStyles.table);
  });

  it('numeric cells and headers carry the right-aligned numeric class', () => {
    renderBrainbase(<WorkPage />);
    expect(screen.getByRole('columnheader', { name: 'Deals' })).toHaveClass(tableStyles.num);
    expect(screen.getByRole('cell', { name: '3' })).toHaveClass(tableStyles.num);
  });

  it('loading is a polite status row, error an alert, empty plain text', () => {
    renderBrainbase(
      <table>
        <tbody>
          <TableStateRow colSpan={2} kind="loading">Loading…</TableStateRow>
          <TableStateRow colSpan={2} kind="error">Could not load.</TableStateRow>
          <TableStateRow colSpan={2} kind="empty">Nothing here.</TableStateRow>
        </tbody>
      </table>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.');
    const empty = screen.getByText('Nothing here.').closest('div');
    expect(empty).not.toHaveAttribute('role');
  });
});

describe('StateMessage', () => {
  it('error is an alert, loading a status, empty is not live', () => {
    renderBrainbase(
      <>
        <StateMessage kind="error" title="Invoice could not be loaded." />
        <StateMessage kind="loading" title="Loading invoice…" />
        <StateMessage kind="empty" title="No invoices yet." action={<Button>New invoice</Button>} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invoice could not be loaded.');
    expect(screen.getByRole('status')).toHaveTextContent('Loading invoice…');
    const empty = screen.getByText('No invoices yet.').parentElement!;
    expect(empty).not.toHaveAttribute('role');
    expect(within(empty).getByRole('button', { name: 'New invoice' })).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(
      <main>
        <StateMessage kind="error" size="page" title="Something went wrong." action={<Button>Retry</Button>}>
          Try again in a moment.
        </StateMessage>
      </main>,
      { theme },
    );
    await expectNoAxeViolations(container);
  });
});

describe('buttonProps', () => {
  it('gives a native link or button the same variant contract as <Button>', () => {
    renderBrainbase(
      <>
        <a href="#new-invoice" {...buttonProps('primary')}>New invoice</a>
        <Button variant="primary">Save</Button>
      </>,
    );
    const link = screen.getByRole('link', { name: 'New invoice' });
    const button = screen.getByRole('button', { name: 'Save' });
    expect(link).toHaveAttribute('data-variant', 'primary');
    expect(link.className).toBe(button.className);
  });
});

function PanelHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add company
      </button>
      <SlidePanel
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Add Company"
      >
        <label htmlFor="name">Name</label>
        <input id="name" />
        <button type="submit">Create</button>
      </SlidePanel>
    </>
  );
}

describe('SlidePanel (shared CRM / People / Commercial shell)', () => {
  it('renders nothing while closed', () => {
    renderBrainbase(<SlidePanel open={false} onClose={() => {}} title="Add Company">body</SlidePanel>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog that moves focus to the first field in its body', async () => {
    const { user } = renderBrainbase(<PanelHarness />);
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Company' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('with no focusable content, focus lands on the panel itself', async () => {
    renderBrainbase(<SlidePanel open onClose={() => {}} title="Person">Read-only details</SlidePanel>);
    expect(screen.getByRole('dialog', { name: 'Person' })).toHaveFocus();
  });

  it('Escape closes it and focus returns to the opener', async () => {
    const onClose = vi.fn();
    const { user } = renderBrainbase(<PanelHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Add company' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('the scrim and the named close button still close it (unchanged pointer behaviour)', async () => {
    const onClose = vi.fn();
    const { user, container } = renderBrainbase(<PanelHarness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    await user.click(screen.getByRole('button', { name: 'Close Add Company' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const scrim = container.ownerDocument.querySelector('[role="dialog"]')!.previousElementSibling!;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps Tab focus inside the panel while open', async () => {
    const { user } = renderBrainbase(<PanelHarness />);
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    const close = screen.getByRole('button', { name: 'Close Add Company' });
    const create = screen.getByRole('button', { name: 'Create' });
    create.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(create).toHaveFocus();
  });

  it.each(['light', 'dark'] as const)('has no axe violations when open (%s)', async theme => {
    const { user, container } = renderBrainbase(<PanelHarness />, { theme });
    await user.click(screen.getByRole('button', { name: 'Add company' }));
    await expectNoAxeViolations(container);
  });
});
