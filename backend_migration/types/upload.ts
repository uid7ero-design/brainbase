import { SchemaType, UploadStatus, Module } from "@prisma/client";

export interface UploadRecord {
  id: string;
  organisation_id: string;
  user_id: string | null;
  original_name: string;
  stored_path: string;
  mimetype: string;
  size_bytes: number;
  schema_type: SchemaType;
  module: Module | null;
  status: UploadStatus;
  row_count: number | null;
  column_count: number | null;
  columns_detected: string[];
  field_mappings: Record<string, string | null>;
  validation_errors: ValidationError[];
  preview_rows: Record<string, unknown>[];
  created_at: Date;
  updated_at: Date;
}

export interface ValidationError {
  row?: number;
  field?: string;
  message: string;
  severity: "error" | "warning";
}

export interface UploadDetectionResult {
  schema_type: SchemaType;
  confidence: number;
  columns_detected: string[];
  field_mappings: Record<string, string | null>;
  validation_errors: ValidationError[];
  preview_rows: Record<string, unknown>[];
  row_count: number;
}

export interface UploadInitiateResponse {
  upload_id: string;
  status: UploadStatus;
  detection: UploadDetectionResult;
}

export interface ColumnMappingOverride {
  [canonical_field: string]: string | null;
}

export interface ImportConfirmRequest {
  upload_id: string;
  field_mappings?: ColumnMappingOverride;
}
