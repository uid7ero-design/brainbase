"use client";

import { usePathname } from "next/navigation";
import styles from "./WasteModule.module.css";

// One page-level h1 per Waste route. On the sub-pages the module title is the
// page's h1. On the Overview (/dashboard/waste) the DashboardShell renders the
// page h1 ("Waste & Recycling"), so the module title becomes a non-heading
// label there — same copy, same appearance.
export const WASTE_OVERVIEW_PATH = "/dashboard/waste";

export default function WasteModuleTitle({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === WASTE_OVERVIEW_PATH) {
    return <p className={styles.title}>{children}</p>;
  }
  return <h1 className={styles.title}>{children}</h1>;
}
