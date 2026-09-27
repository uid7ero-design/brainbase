import NavTabs from "./NavTabs";
import WasteModuleTitle from "./WasteModuleTitle";
import styles from "./WasteModule.module.css";

// Authenticated visual-completion pass: the module frame follows the app
// theme (tokens in WasteModule.module.css). WasteModuleTitle keeps exactly
// one page-level h1 per route: it is the h1 on sub-pages and a label on the
// Overview, where DashboardShell renders the page h1.
export default function WasteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.eyebrow}>Executive Operations Report</p>
          <WasteModuleTitle>Waste &amp; Recycling Intelligence</WasteModuleTitle>
          <NavTabs />
        </div>
      </div>
      {children}
    </div>
  );
}
