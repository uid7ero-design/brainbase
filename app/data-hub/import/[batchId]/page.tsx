import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import RecoveryClient from "./RecoveryClient";

// Data Hub 5A.3D.2 — direct import-recovery route. Manager-gated exactly
// like the canonical /data-hub/import page (app/data-hub/import/page.tsx) —
// same defense-in-depth/UX-only page guard, same real authorization
// boundary (every app/api/data-hub/** route independently enforces
// requireRole("manager") and resolves organisationId server-side only, from
// the session — never from anything in this route's own params).
//
// The URL carries ONLY batchId (spec Section 15) — no orgId, no status, no
// worksheetId. batchId is NOT authorization: it is passed straight through
// to the existing, unmodified, tenant-scoped resumeFromBatchId() ->
// GET /api/data-hub/import-batches/[id] read, which already collapses
// not-found, wrong-tenant, and malformed ids into the identical safe
// BATCH_NOT_FOUND outcome (5A.3D.1's own documented behavior) — this page
// adds no separate existence/ownership check of its own.
export const dynamic = "force-dynamic";

export default async function DataHubImportRecoveryPage({ params }: { params: Promise<{ batchId: string }> }) {
  try {
    await requireRole("manager");
  } catch {
    redirect("/login");
  }

  const { batchId } = await params;

  return <RecoveryClient batchId={batchId} />;
}
