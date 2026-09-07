import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import ImportClient from "./ImportClient";

// Data Hub 5A.3C.1 — canonical manager-facing Data Hub import experience.
// Page-level guard is defense-in-depth/UX only, matching every other
// established manager-page in this repo (app/dashboard/leads/page.tsx,
// app/clients/page.tsx) — the REAL authorization boundary is the existing,
// already-shipped, unchanged Data Hub API layer (every route under
// app/api/data-hub/** independently enforces requireRole("manager")).
export const dynamic = "force-dynamic";

export default async function DataHubImportPage() {
  try {
    await requireRole("manager");
  } catch {
    redirect("/login");
  }

  return <ImportClient />;
}
