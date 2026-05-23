export type { Module, SchemaType, Severity, Priority } from "@prisma/client";

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  error_code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface OrgContext {
  organisation_id: string;
  user_id?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}
