import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

// Authenticated-app button (Phase A foundation). Visual contract only:
// every native button attribute and handler passes straight through, so
// adopting it never changes behaviour. Defaults to type="button" so a
// button inside a <form> never submits unless the caller asks for it.
//
// Variants:
//   primary   — the one main action in a region (product accent)
//   secondary — neutral bordered action (replaces the dark "#1f2937" slabs)
//   ghost     — low-emphasis action in dense rows and toolbars
//   danger    — destructive action (semantic red, never product purple)
// Focus uses the global :focus-visible ring from app/globals.css.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * The same visual contract for elements that must stay native — a Next
 * `<Link>` that should look like a button, or an existing `<button>` whose
 * markup other code depends on. Spread the result onto the element:
 *   <Link href="…" {...buttonProps('primary')}>New invoice</Link>
 */
export function buttonProps(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return { className: styles.button, 'data-variant': variant, 'data-size': size } as const;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={[styles.button, className ?? ''].join(' ').trim()}
      {...rest}
    />
  );
}
