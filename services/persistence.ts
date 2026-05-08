import { prisma } from "@/lib/prisma";
import { Module, Prisma } from "@prisma/client";

// ── Dashboard configs ─────────────────────────────────────────────────────────

export async function getDashboardConfig(
  organisation_id: string,
  module: Module,
  user_id?: string
) {
  const config = await prisma.dashboardConfig.findFirst({
    where: {
      organisation_id,
      module,
      ...(user_id
        ? { OR: [{ user_id }, { is_default: true, user_id: null }] }
        : { is_default: true }),
    },
    orderBy: [{ user_id: "desc" }, { created_at: "desc" }],
  });
  return config?.config ?? null;
}

export async function saveDashboardConfig(params: {
  organisation_id: string;
  module: Module;
  name: string;
  config: Record<string, unknown>;
  user_id?: string;
  is_default?: boolean;
}) {
  const { organisation_id, module, name, config, user_id, is_default } = params;

  const existing = await prisma.dashboardConfig.findFirst({
    where: { organisation_id, module, user_id: user_id ?? null, name },
  });

  if (existing) {
    return prisma.dashboardConfig.update({
      where: { id: existing.id },
      data:  { config: config as Prisma.InputJsonValue, updated_at: new Date() },
    });
  }

  return prisma.dashboardConfig.create({
    data: {
      organisation_id, module, name,
      config:    config as Prisma.InputJsonValue,
      user_id:   user_id   ?? null,
      is_default: is_default ?? false,
    },
  });
}

// ── Saved views ───────────────────────────────────────────────────────────────

export async function getSavedViews(
  organisation_id: string,
  module: Module,
  user_id?: string
) {
  return prisma.savedView.findMany({
    where: {
      organisation_id,
      module,
      OR: [{ user_id: user_id ?? null }, { is_shared: true }],
    },
    orderBy: { updated_at: "desc" },
  });
}

export async function saveView(params: {
  organisation_id: string;
  module: Module;
  name: string;
  filters: Record<string, unknown>;
  columns?: string[];
  sort_field?: string;
  sort_direction?: string;
  user_id?: string;
  is_shared?: boolean;
}) {
  const { organisation_id, module, name, filters, columns, sort_field, sort_direction, user_id, is_shared } = params;
  return prisma.savedView.create({
    data: {
      organisation_id, module, name,
      filters:        filters as Prisma.InputJsonValue,
      columns:        columns ?? [],
      sort_field:     sort_field     ?? null,
      sort_direction: sort_direction ?? null,
      user_id:        user_id        ?? null,
      is_shared:      is_shared      ?? false,
    },
  });
}

export async function deleteView(id: string, organisation_id: string) {
  return prisma.savedView.deleteMany({ where: { id, organisation_id } });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function getOpenAlerts(organisation_id: string, module?: Module) {
  return prisma.alert.findMany({
    where: {
      organisation_id,
      status: "OPEN",
      ...(module ? { module } : {}),
    },
    orderBy: [{ severity: "asc" }, { created_at: "desc" }],
  });
}

export async function acknowledgeAlert(id: string, acknowledged_by: string) {
  return prisma.alert.update({
    where: { id },
    data: {
      status:          "ACKNOWLEDGED",
      acknowledged_by,
      acknowledged_at: new Date(),
    },
  });
}

export async function createAlert(params: {
  organisation_id: string;
  module?: Module;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  rule_key?: string;
}) {
  return prisma.alert.create({ data: params });
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function writeAuditLog(params: {
  organisation_id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  before_state?: unknown;
  after_state?: unknown;
  ip_address?: string;
}) {
  return prisma.auditLog.create({
    data: {
      organisation_id: params.organisation_id,
      user_id:         params.user_id      ?? null,
      action:          params.action,
      resource_type:   params.resource_type,
      resource_id:     params.resource_id  ?? null,
      before_state:    (params.before_state ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      after_state:     (params.after_state  ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      ip_address:      params.ip_address   ?? null,
    },
  });
}

// ── Metrics (KPI persistence) ─────────────────────────────────────────────────

export async function persistMetrics(metrics: Array<{
  organisation_id: string;
  upload_id?: string;
  module: Module;
  period_start: Date;
  period_end: Date;
  metric_key: string;
  metric_value: number;
  unit?: string;
  dimension?: string;
  dimension_value?: string;
  metadata?: Record<string, unknown>;
}>) {
  if (metrics.length === 0) return;
  return prisma.metric.createMany({
    data: metrics.map(m => ({
      organisation_id: m.organisation_id,
      upload_id:       m.upload_id       ?? null,
      module:          m.module,
      period_start:    m.period_start,
      period_end:      m.period_end,
      metric_key:      m.metric_key,
      metric_value:    m.metric_value,
      unit:            m.unit            ?? null,
      dimension:       m.dimension       ?? null,
      dimension_value: m.dimension_value ?? null,
      metadata:        (m.metadata ?? {}) as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
}

export async function getMetrics(params: {
  organisation_id: string;
  module: Module;
  metric_key?: string;
  period_start?: Date;
  period_end?: Date;
  dimension?: string;
}) {
  return prisma.metric.findMany({
    where: {
      organisation_id: params.organisation_id,
      module:          params.module,
      ...(params.metric_key ? { metric_key: params.metric_key } : {}),
      ...(params.dimension  ? { dimension:  params.dimension  } : {}),
      ...(params.period_start && params.period_end ? {
        period_start: { gte: params.period_start },
        period_end:   { lte: params.period_end },
      } : {}),
    },
    orderBy: { period_start: "asc" },
  });
}
