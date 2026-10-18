import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import AnalysisReviewClient from "./AnalysisReviewClient";
import { reviewWorkbookHint } from "@/lib/data-hub/client/reviewNavigation";

export const dynamic = "force-dynamic";

export default async function AnalysisReviewPage({ params, searchParams }: { params: Promise<{ uploadId: string }>; searchParams?: Promise<{ workbook?: string | string[] }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { uploadId } = await params;
  const query = await searchParams;
  return <AnalysisReviewClient key={uploadId} uploadId={uploadId} workbookHint={reviewWorkbookHint(query?.workbook)} />;
}
