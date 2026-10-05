import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import styles from './ModuleNav.module.css';

// Shared module navigation (Phase D1). One visual language for the
// module-local sidebars (CRM, Commercial, Admin), matching the global
// chrome: neutral surface, compact items, product accent ONLY on the
// current destination (accent text, weight 600, 2px inset rule, muted
// tint — never colour alone: `aria-current="page"` carries the state).
//
// It owns no behaviour. Callers keep their own item lists, gating and
// active-route rules; positioning (sticky + header offset) is passed in
// through `style` so each module keeps its layout contract. Below 768px
// the sidebar becomes a horizontal, scrollable strip above the content.
//
//   <ModuleSidebar title="CRM" label="CRM sections" style={{ position: 'sticky', top: APP_HEADER_OFFSET_VAR }}>
//     <ModuleNavItem href="/crm" active={pathname === '/crm'}>Overview</ModuleNavItem>
//   </ModuleSidebar>

export type ModuleSidebarProps = {
  /** Module identity, e.g. "CRM". Typography, not colour. */
  title: ReactNode;
  /** Optional second line under the title (e.g. the signed-in name). */
  subtitle?: ReactNode;
  /** Accessible name for the <nav> landmark. */
  label: string;
  children: ReactNode;
  /** Pinned to the bottom (e.g. "Back to app", Sign out). */
  footer?: ReactNode;
  /** Layout/positioning owned by the caller (sticky top, height, width). */
  style?: CSSProperties;
};

export function ModuleSidebar({ title, subtitle, label, children, footer, style }: ModuleSidebarProps) {
  return (
    <aside className={styles.sidebar} style={style} data-module-sidebar="">
      <div className={styles.identity}>
        <div className={styles.title}>{title}</div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      <nav aria-label={label} className={styles.nav}>
        {children}
      </nav>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  );
}

/**
 * Props for a module nav link rendered by hand (e.g. a plain <a> or an
 * existing <Link> whose markup other code depends on).
 */
export function moduleNavItemProps(active: boolean) {
  return { className: styles.item, 'aria-current': active ? ('page' as const) : undefined };
}

export type ModuleNavItemProps = {
  href: string;
  active: boolean;
  children: ReactNode;
};

export function ModuleNavItem({ href, active, children }: ModuleNavItemProps) {
  return (
    <Link href={href} {...moduleNavItemProps(active)}>
      {children}
    </Link>
  );
}

/** Group label inside a module nav (e.g. "Operations"). */
export function ModuleNavSection({ children }: { children: ReactNode }) {
  return <div className={styles.section}>{children}</div>;
}

/** Quiet footer action (link or button) in a ModuleSidebar footer. */
export const moduleNavFooterItemClassName = styles.footerItem;
