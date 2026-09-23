// Data Hub 5A.3C.1 — pure, framework-free file-selection advisory checks.
//
// ADVISORY ONLY (discovery Section K / spec Section 12): these checks never
// block `session.start()` from being called and never attempt to parse or
// validate CSV structure — the server (finalize's size preflight, inspect's
// CSV-only gate, confirm's header validation) remains the sole authority.
// This module exists only so the picker can show a helpful warning before a
// pointless round-trip, never to pretend a file is "valid".
//
// Data Hub 6.2D1 — .xlsx is now selectable for STRUCTURAL worksheet
// inspection only (the server classifies the format itself at initiate and
// dispatches inspection on that persisted classification; XLSX preview and
// import remain disabled server-side). Legacy .xls is deliberately NOT
// offered: the live inspect route treats it as UNSUPPORTED_FORMAT. Nothing
// here reads file content — only the name and size.
import { MAX_SOURCE_FILE_BYTES } from "@/lib/data-hub/limits";

const SUPPORTED_EXTENSION = /\.(csv|xlsx)$/i;

export interface FileSelectionAdvisory {
  /** True iff no warnings were produced. Never used to block start(). */
  ok: boolean;
  warnings: string[];
}

export function validateSelectedFile(file: File): FileSelectionAdvisory {
  const warnings: string[] = [];

  if (!SUPPORTED_EXTENSION.test(file.name)) {
    warnings.push("This doesn't look like a .csv or .xlsx file. Only CSV and Excel (.xlsx) files are supported.");
  }

  if (file.size === 0) {
    warnings.push("This file is empty.");
  } else if (file.size > MAX_SOURCE_FILE_BYTES) {
    const maxMb = Math.floor(MAX_SOURCE_FILE_BYTES / (1024 * 1024));
    warnings.push(`This file is larger than the ${maxMb} MB maximum. The server will reject it.`);
  }

  return { ok: warnings.length === 0, warnings };
}

export const FILE_INPUT_ACCEPT = ".csv,text/csv,.xlsx";
