import { prisma } from "../../prisma";
import { previewWorksheet, type PreviewWorksheetResult } from "./previewWorksheet";
import type { PreviewXlsxWorksheetResult } from "./previewXlsxWorksheet";

// Data Hub 6.2D2 — trusted worksheet preview format dispatcher.
//
// The ONLY inputs are the trusted session organisationId and the path
// worksheetId. The format is derived exclusively from the tenant-scoped,
// DATA_HUB-lineage worksheet's own persisted parent ImportBatch.content_type
// — never from request body/query/filename hints.
//
// Only a persisted "xlsx" batch is routed to previewXlsxWorksheet (loaded
// lazily, so the CSV path never pulls xlsx/workbookParser into the module
// graph). EVERYTHING else — csv, xls, unknown, missing worksheet, wrong
// tenant, legacy lineage, missing/tombstoned batch — is delegated unchanged
// to the CSV previewWorksheet service, which re-reads every fact itself and
// therefore keeps its exact pre-6.2D2 codes and precedence (including
// UNSUPPORTED_FORMAT for xls before any storage access). The xlsx service
// likewise re-reads and re-checks every eligibility/lineage fact itself;
// this lookup is a routing hint only, never an authorization decision.
//
// READ-ONLY: two findFirst/findUnique reads, zero writes.

export type PreviewDataHubWorksheetResult = PreviewWorksheetResult | PreviewXlsxWorksheetResult;

export async function previewDataHubWorksheet(context: {
  organisationId: string;
  worksheetId: string;
}): Promise<PreviewDataHubWorksheetResult> {
  const { organisationId, worksheetId } = context;
  const worksheet = await prisma.upload.findFirst({
    where: { id: worksheetId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { import_batch_id: true },
  });
  if (worksheet?.import_batch_id) {
    const batch = await prisma.importBatch.findUnique({
      where: { id_organisation_id: { id: worksheet.import_batch_id, organisation_id: organisationId } },
      select: { content_type: true },
    });
    if (batch?.content_type === "xlsx") {
      const { previewXlsxWorksheet } = await import("./previewXlsxWorksheet");
      return previewXlsxWorksheet({ organisationId, worksheetId });
    }
  }
  return previewWorksheet({ organisationId, worksheetId });
}
