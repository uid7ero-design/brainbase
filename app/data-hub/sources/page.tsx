import { redirect } from "next/navigation";
import { requireRole, roleGte } from "@/lib/org";
import SourcesAdminClient from "./SourcesAdminClient";

// Data Hub 6.1C — Source configuration admin surface. Page-level guard
// matches app/data-hub/import/page.tsx's own established pattern exactly:
// gated at manager+ (the READ floor, matching every existing source-system/
// source-mapping GET route), UX/defense-in-depth only — the REAL
// authorization boundary is the existing, unchanged API layer, where every
// mutating route independently enforces requireRole("admin"). `isAdmin` is
// computed here (a Server Component, where lib/org.ts's `server-only`
// import is safe) and passed down as a plain boolean prop — never import
// lib/org.ts or lib/session.ts from the client component, both carry
// `server-only`/DB-adjacent imports that must not reach the browser bundle.
export const dynamic = "force-dynamic";

export default async function DataHubSourcesPage() {
  let isAdmin: boolean;
  try {
    const session = await requireRole("manager");
    isAdmin = roleGte(session.role, "admin");
  } catch {
    redirect("/login");
  }

  return <SourcesAdminClient isAdmin={isAdmin} />;
}
