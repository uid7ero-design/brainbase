import { redirect } from "next/navigation";
import { requireRole } from "@/lib/org";
import MappingSetupClient from "./MappingSetupClient";
export const dynamic = "force-dynamic";
export default async function MappingSetupPage({ params }: { params: Promise<{ uploadId: string }> }) {
  try { await requireRole("manager"); } catch { redirect("/login"); }
  const { uploadId } = await params;
  return <MappingSetupClient key={uploadId} uploadId={uploadId} />;
}
