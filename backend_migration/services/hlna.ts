/**
 * HLNA Service — AI briefing and insight layer.
 *
 * Calls the Brainbase Agent Command Centre (Python FastAPI) for intelligence,
 * persists results to DB so they are queryable and never lost on refresh.
 */

import { prisma } from "@/lib/prisma";
import { Module, InsightType, Priority, InsightStatus } from "@prisma/client";
import type { HlnaBriefingRequest, HlnaBriefingResponse, InsightEvidence } from "@/types/hlna";

const HLNA_API = process.env.HLNA_API_URL ?? "http://localhost:8000";
const HLNA_KEY = process.env.HLNA_ADMIN_KEY ?? "";

async function callHlnaApi(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${HLNA_API}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key":  HLNA_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HLNA API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Briefings ─────────────────────────────────────────────────────────────────

export async function generateAndPersistBriefing(
  req: HlnaBriefingRequest
): Promise<HlnaBriefingResponse> {
  const raw = await callHlnaApi("/api/admin/founder-intelligence", {
    organisation_id: req.organisation_id,
    module:          req.module,
    context:         req.context ?? {},
  }) as Record<string, unknown>;

  const record = await prisma.hlnaBriefing.create({
    data: {
      organisation_id:    req.organisation_id,
      module:             (req.module as Module) ?? null,
      summary:            String(raw.summary ?? ""),
      opportunities:      (raw.opportunities as string[]) ?? [],
      risks:              (raw.risks as string[]) ?? [],
      recommended_actions: (raw.recommended_actions as string[]) ?? [],
      confidence:         Number(raw.confidence ?? 0.5),
      model_version:      "gpt-4o-mini",
    },
  });

  return {
    id:                  record.id,
    summary:             record.summary,
    opportunities:       record.opportunities as string[],
    risks:               record.risks as string[],
    recommended_actions: record.recommended_actions as string[],
    confidence:          record.confidence,
    created_at:          record.created_at.toISOString(),
  };
}

export async function getLatestBriefing(
  organisation_id: string,
  module?: Module
): Promise<HlnaBriefingResponse | null> {
  const record = await prisma.hlnaBriefing.findFirst({
    where:   { organisation_id, ...(module ? { module } : {}) },
    orderBy: { created_at: "desc" },
  });
  if (!record) return null;
  return {
    id:                  record.id,
    summary:             record.summary,
    opportunities:       record.opportunities as string[],
    risks:               record.risks as string[],
    recommended_actions: record.recommended_actions as string[],
    confidence:          record.confidence,
    created_at:          record.created_at.toISOString(),
  };
}

// ── Insights ──────────────────────────────────────────────────────────────────

export async function persistInsight(params: {
  organisation_id: string;
  upload_id?: string;
  module?: Module;
  insight_type: InsightType;
  title: string;
  body: string;
  evidence: InsightEvidence;
  confidence: number;
  priority: Priority;
}) {
  return prisma.hlnaInsight.create({
    data: {
      ...params,
      upload_id: params.upload_id ?? null,
      module:    params.module    ?? null,
    },
  });
}

export async function getInsights(params: {
  organisation_id: string;
  module?: Module;
  status?: InsightStatus;
  limit?: number;
}) {
  return prisma.hlnaInsight.findMany({
    where: {
      organisation_id: params.organisation_id,
      ...(params.module ? { module: params.module } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: [{ priority: "asc" }, { created_at: "desc" }],
    take: params.limit ?? 50,
  });
}

export async function dismissInsight(id: string, organisation_id: string) {
  return prisma.hlnaInsight.updateMany({
    where: { id, organisation_id },
    data:  { status: InsightStatus.DISMISSED, dismissed_at: new Date() },
  });
}

// ── Post-upload analysis trigger ──────────────────────────────────────────────

export async function analyseUpload(
  upload_id: string,
  organisation_id: string,
  module: Module | null
): Promise<void> {
  if (!module) return;

  try {
    // Fetch KPI context for this upload and call the Python intelligence engine
    const kpiContext = await buildUploadContext(upload_id, organisation_id, module);
    const raw = await callHlnaApi("/run", {
      query:    `Analyse this ${module} operational upload and identify anomalies, risks, and opportunities.`,
      context:  kpiContext,
    }) as Record<string, unknown>;

    const result = (raw as Record<string, unknown>).result as Record<string, unknown> | undefined;
    if (!result) return;

    // Persist insights from pipeline output
    const risks = (result.risks as unknown[]) ?? [];
    for (const r of risks as Record<string, unknown>[]) {
      await persistInsight({
        organisation_id,
        upload_id,
        module,
        insight_type: InsightType.RISK,
        title:       String(r.title ?? "Risk identified"),
        body:        String(r.insight ?? r.why_it_matters ?? ""),
        evidence:    (r.evidence as InsightEvidence) ?? {},
        confidence:  Number(r.confidence ?? 0.6),
        priority:    mapSeverityToPriority(String(r.severity ?? "medium")),
      });
    }
  } catch (err) {
    console.error("[hlna] analyseUpload failed:", err);
  }
}

function mapSeverityToPriority(severity: string): Priority {
  switch (severity.toLowerCase()) {
    case "critical": return Priority.URGENT;
    case "high":     return Priority.HIGH;
    case "low":      return Priority.LOW;
    default:         return Priority.MEDIUM;
  }
}

async function buildUploadContext(
  upload_id: string,
  organisation_id: string,
  module: Module
): Promise<Record<string, unknown>> {
  const upload = await prisma.upload.findUnique({
    where: { id: upload_id },
    select: { schema_type: true, row_count: true, columns_detected: true, preview_rows: true },
  });
  return {
    upload_id,
    organisation_id,
    module,
    schema_type:      upload?.schema_type,
    row_count:        upload?.row_count,
    columns_detected: upload?.columns_detected,
    sample:           (upload?.preview_rows as unknown[])?.slice(0, 5) ?? [],
  };
}
