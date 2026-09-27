import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Field, fieldControlClassName } from '@/components/ui/app';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectDescribedBy } from '../../a11y/accessibility';

function Controlled({ error, helper }: { error?: string; helper?: string }) {
  const [value, setValue] = useState('');
  return (
    <Field label="Company name" required helper={helper} error={error}>
      {control => (
        <input {...control} className={fieldControlClassName} value={value} onChange={e => setValue(e.target.value)} />
      )}
    </Field>
  );
}

describe('App Field shell (Phase A primitive)', () => {
  it.each(['light', 'dark'] as const)('has no axe violations with helper and error (%s)', async theme => {
    const { container } = renderBrainbase(<Controlled helper="As shown on invoices." error="Company name is required." />, {
      theme,
    });
    await expectNoAxeViolations(container);
  });

  it('associates the label with the control', () => {
    renderBrainbase(<Controlled />);
    expect(screen.getByRole('textbox', { name: /Company name/ })).toBeInTheDocument();
  });

  it('shows "Required" as visible text, not colour alone', () => {
    renderBrainbase(<Controlled />);
    expect(screen.getByText('Required')).toBeVisible();
  });

  it('describes the control by its helper text', () => {
    renderBrainbase(<Controlled helper="As shown on invoices." />);
    const input = screen.getByRole('textbox', { name: /Company name/ });
    expectDescribedBy(input, screen.getByText('As shown on invoices.'));
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and describes it by helper and error', () => {
    renderBrainbase(<Controlled helper="As shown on invoices." error="Company name is required." />);
    const input = screen.getByRole('textbox', { name: /Company name/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('As shown on invoices. Company name is required.');
  });

  it('leaves value and change handling entirely to the caller', async () => {
    const { user } = renderBrainbase(<Controlled />);
    const input = screen.getByRole('textbox', { name: /Company name/ });
    await user.type(input, 'Acme');
    expect(input).toHaveValue('Acme');
  });

  it('keeps a caller-supplied id so existing labels and tests still target it', () => {
    renderBrainbase(
      <Field label="Reference" id="po-reference">
        {control => <input {...control} />}
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveAttribute('id', 'po-reference');
  });
});
