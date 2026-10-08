import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import AnalysisReviewClient from "./AnalysisReviewClient";

export const dynamic = "force-dynamic";

export default async function AnalysisReviewPage({ params }: { params: Promise<{ uploadId: string }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { uploadId } = await params;
  return <AnalysisReviewClient key={uploadId} uploadId={uploadId} />;
}
