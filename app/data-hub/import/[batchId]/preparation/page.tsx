import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import WorkbookPreparationClient from "./WorkbookPreparationClient";

export const dynamic = "force-dynamic";
export default async function WorkbookPreparationPage({ params }: { params: Promise<{ batchId: string }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { batchId } = await params;
  return <WorkbookPreparationClient key={batchId} batchId={batchId} />;
}
