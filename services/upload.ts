import { prisma } from "@/lib/prisma";
import { detectSchema } from "@/lib/schema-detector";
import { mapColumns } from "@/lib/column-mapper";
import { SchemaType, Module, UploadStatus, Prisma } from "@prisma/client";
import { parse as csvParse } from "csv-parse/sync";
import * as xlsx from "xlsx";
import type { UploadDetectionResult, ValidationError } from "@/types/upload";

const SCHEMA_TO_MODULE: Partial<Record<SchemaType, Module>> = {
  MISSED_COLLECTIONS: "MISSED_COLLECTIONS",
  ILLEGAL_DUMPING:    "DUMPING",
  DEBTORS:            "DEBTORS",
  SERVICE_REQUESTS:   "WASTE",
  BIN_MAINTENANCE:    "BIN_MAINTENANCE",
  WASTE_METRICS:      "WASTE",
  FINANCIAL:          "DEBTORS",
};

// ── File parsing ──────────────────────────────────────────────────────────────

export function parseFile(
  buffer: Buffer,
  mimetype: string,
  filename: string
): { columns: string[]; rows: Record<string, unknown>[] } {
  const isCsv  = mimetype === "text/csv" || filename.endsWith(".csv");
  const isXlsx = mimetype.includes("spreadsheetml") || filename.endsWith(".xlsx") || filename.endsWith(".xls");

  if (isCsv) {
    const records = csvParse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, unknown>[];
    return { columns: records.length > 0 ? Object.keys(records[0]) : [], rows: records };
  }

  if (isXlsx) {
    const wb   = xlsx.read(buffer, { type: "buffer", cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateRows(
  rows: Record<string, unknown>[],
  schemaType: SchemaType,
  fieldMappings: Record<string, string | null>
): ValidationError[] {
  const errors: ValidationError[] = [];

  const requiredBySchema: Partial<Record<SchemaType, string[]>> = {
    MISSED_COLLECTIONS: ["address", "scheduled_date", "status"],
    ILLEGAL_DUMPING:    ["location", "report_date", "waste_type"],
    DEBTORS:            ["account_number", "outstanding_amount"],
    SERVICE_REQUESTS:   ["request_date", "request_type"],
    BIN_MAINTENANCE:    ["suburb", "address", "issue_type"],
  };

  for (const canonical of requiredBySchema[schemaType] ?? []) {
    if (!fieldMappings[canonical]) {
      errors.push({ field: canonical, message: `Required field '${canonical}' could not be mapped`, severity: "error" });
    }
  }

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    for (const [canonical, raw] of Object.entries(fieldMappings)) {
      if (!raw || !canonical.includes("date")) continue;
      const val = row[raw];
      if (val && typeof val === "string" && isNaN(Date.parse(val))) {
        errors.push({ row: i + 1, field: canonical, message: `'${val}' is not a recognisable date`, severity: "warning" });
      }
    }
    for (const [canonical, raw] of Object.entries(fieldMappings)) {
      if (!raw || !["outstanding_amount", "response_hours", "complaint_count"].includes(canonical)) continue;
      const val = row[raw];
      if (val !== null && val !== undefined && val !== "" && isNaN(Number(val))) {
        errors.push({ row: i + 1, field: canonical, message: `'${val}' is not a number for '${canonical}'`, severity: "warning" });
      }
    }
  }

  return errors;
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function initiateUpload(params: {
  organisation_id: string;
  user_id?: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
  stored_path: string;
}): Promise<{ upload_id: string; detection: UploadDetectionResult }> {
  const { organisation_id, user_id, filename, mimetype, buffer, stored_path } = params;

  const { columns, rows } = parseFile(buffer, mimetype, filename);
  const detection  = detectSchema(columns);
  const schemaType = detection.schema_type;
  const module     = SCHEMA_TO_MODULE[schemaType] ?? null;
  const fieldMappings = mapColumns(columns, schemaType);
  const validationErrors = validateRows(rows, schemaType, fieldMappings);
  const previewRows = rows.slice(0, 10);

  const record = await prisma.upload.create({
    data: {
      organisation_id,
      user_id:          user_id ?? null,
      original_name:    filename,
      stored_path,
      mimetype,
      size_bytes:       buffer.length,
      schema_type:      schemaType,
      module,
      status:           validationErrors.some(e => e.severity === "error")
                          ? UploadStatus.VALIDATING
                          : UploadStatus.PREVIEW_READY,
      row_count:        rows.length,
      column_count:     columns.length,
      columns_detected: columns as unknown as Prisma.InputJsonValue,
      field_mappings:   fieldMappings as unknown as Prisma.InputJsonValue,
      validation_errors: validationErrors as unknown as Prisma.InputJsonValue,
      preview_rows:     previewRows as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    upload_id: record.id,
    detection: { schema_type: schemaType, confidence: detection.confidence, columns_detected: columns, field_mappings: fieldMappings, validation_errors: validationErrors, preview_rows: previewRows, row_count: rows.length },
  };
}

export async function confirmImport(params: {
  upload_id: string;
  organisation_id: string;
  field_mappings?: Record<string, string | null>;
}): Promise<{ imported_rows: number }> {
  const { upload_id, organisation_id, field_mappings } = params;

  const upload = await prisma.upload.findFirst({ where: { id: upload_id, organisation_id } });
  if (!upload) throw new Error("Upload not found");
  if (upload.status === "IMPORTING" || upload.status === "COMPLETE") throw new Error("Upload already imported");

  const finalMappings = {
    ...(upload.field_mappings as Record<string, string | null>),
    ...(field_mappings ?? {}),
  };

  await prisma.upload.update({
    where: { id: upload_id },
    data:  { status: UploadStatus.IMPORTING, field_mappings: finalMappings as unknown as Prisma.InputJsonValue },
  });

  const imported = await importRowsForModule(upload, finalMappings);

  await prisma.upload.update({ where: { id: upload_id }, data: { status: UploadStatus.COMPLETE } });

  return { imported_rows: imported };
}

async function importRowsForModule(
  upload: { id: string; organisation_id: string; schema_type: string; stored_path: string },
  fieldMappings: Record<string, string | null>
): Promise<number> {
  const schemaType = upload.schema_type as SchemaType;

  switch (schemaType) {
    case "MISSED_COLLECTIONS": {
      const { importMissedCollections } = await import("@/modules/missed-collections");
      return importMissedCollections(upload.id, upload.organisation_id, upload.stored_path, fieldMappings);
    }
    case "ILLEGAL_DUMPING": {
      const { importIllegalDumping } = await import("@/modules/dumping");
      return importIllegalDumping(upload.id, upload.organisation_id, upload.stored_path, fieldMappings);
    }
    case "DEBTORS": {
      const { importDebtors } = await import("@/modules/debtors");
      return importDebtors(upload.id, upload.organisation_id, upload.stored_path, fieldMappings);
    }
    case "SERVICE_REQUESTS": {
      const { importServiceRequests } = await import("@/modules/waste");
      return importServiceRequests(upload.id, upload.organisation_id, upload.stored_path, fieldMappings);
    }
    case "BIN_MAINTENANCE": {
      const { importBinMaintenance } = await import("@/modules/bin-maintenance");
      return importBinMaintenance(upload.id, upload.organisation_id, upload.stored_path, fieldMappings);
    }
    default:
      return 0;
  }
}

export async function getUploadHistory(organisation_id: string, limit = 50) {
  return prisma.upload.findMany({
    where:   { organisation_id },
    orderBy: { created_at: "desc" },
    take:    limit,
    select:  { id: true, original_name: true, schema_type: true, module: true, status: true, row_count: true, size_bytes: true, created_at: true },
  });
}
