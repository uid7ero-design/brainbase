import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import RunsPilotReviewClient from "./RunsPilotReviewClient";

export const dynamic = "force-dynamic";
export default async function RunsPilotReviewPage() {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  return <RunsPilotReviewClient />;
}
