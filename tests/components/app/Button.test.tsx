import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Button } from '@/components/ui/app';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectKeyboardActivation } from '../../a11y/keyboard';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;

describe('App Button (Phase A primitive)', () => {
  it.each(['light', 'dark'] as const)('has no axe violations in any variant (%s)', async theme => {
    const { container } = renderBrainbase(
      <div>
        {VARIANTS.map(v => (
          <Button key={v} variant={v}>
            {v} action
          </Button>
        ))}
        <Button disabled>Disabled action</Button>
      </div>,
      { theme },
    );
    await expectNoAxeViolations(container);
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderBrainbase(
      <form onSubmit={onSubmit}>
        <Button>Save draft</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Save draft' });
    expect(button).toHaveAttribute('type', 'button');
    button.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still submits when the caller asks for type="submit" (behaviour passes through)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderBrainbase(
      <form onSubmit={onSubmit}>
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>,
    );
    screen.getByRole('button', { name: 'Create' }).click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('activates with Enter and Space', async () => {
    const onClick = vi.fn();
    const { user } = renderBrainbase(<Button onClick={onClick}>Assign</Button>);
    const button = screen.getByRole('button', { name: 'Assign' });
    await expectKeyboardActivation(user, button, onClick, 'Enter');
    await expectKeyboardActivation(user, button, onClick, 'Space');
  });

  it('exposes its variant and size for styling and passes native props through', () => {
    renderBrainbase(
      <Button variant="danger" size="sm" aria-describedby="hint" data-testid="del">
        Delete
      </Button>,
    );
    const button = screen.getByTestId('del');
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button).toHaveAttribute('data-size', 'sm');
    expect(button).toHaveAttribute('aria-describedby', 'hint');
  });

  it('disabled buttons are not activatable', async () => {
    const onClick = vi.fn();
    const { user } = renderBrainbase(
      <Button disabled onClick={onClick}>
        Archive
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
