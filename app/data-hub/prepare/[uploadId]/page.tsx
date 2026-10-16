import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import WorksheetPreparationClient from "./WorksheetPreparationClient";

export const dynamic = "force-dynamic";
export default async function WorksheetPreparationPage({ params }: { params: Promise<{ uploadId: string }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { uploadId } = await params;
  return <WorksheetPreparationClient key={uploadId} uploadId={uploadId} />;
}
