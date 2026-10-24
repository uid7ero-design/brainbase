import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import WorkbookReviewsClient from "./WorkbookReviewsClient";

export const dynamic = "force-dynamic";
export default async function WorkbookReviewsPage({ params }: { params: Promise<{ batchId: string }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { batchId } = await params;
  return <WorkbookReviewsClient key={batchId} batchId={batchId} />;
}
