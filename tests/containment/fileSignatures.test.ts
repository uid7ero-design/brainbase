import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  classifyFormat,
  validateSignature,
  matchesSignature,
  containsNulByte,
  FileSignatureError,
  ZIP_SIGNATURE,
  OLE_SIGNATURE,
} from "@/lib/data-hub/fileSignatures";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

// ─── Zero xlsx dependency (5A.2G.1, Step 5/20 hard requirement) ───────

describe("fileSignatures — zero xlsx dependency", () => {
  it("never imports xlsx", () => {
    const code = read("lib/data-hub/fileSignatures.ts");
    expect(code).not.toMatch(/from\s+["']xlsx["']/);
    expect(code).not.toMatch(/require\(["']xlsx["']\)/);
  });

  it("never imports workbookParser (which itself imports xlsx)", () => {
    const code = read("lib/data-hub/fileSignatures.ts");
    expect(code).not.toMatch(/from\s+["'].*workbookParser["']/);
    expect(code).not.toMatch(/require\(["'].*workbookParser["']\)/);
  });

  it("has no import statements at all", () => {
    const code = read("lib/data-hub/fileSignatures.ts");
    expect(code).not.toMatch(/^\s*import\s/m);
  });
});

// ─── classifyFormat ────────────────────────────────────────────────────

describe("fileSignatures — classifyFormat", () => {
  it("classifies .csv", () => {
    expect(classifyFormat({ filename: "data.csv" })).toBe("csv");
  });

  it("classifies .xls", () => {
    expect(classifyFormat({ filename: "legacy.xls" })).toBe("xls");
  });

  it("classifies .xlsx", () => {
    expect(classifyFormat({ filename: "modern.xlsx" })).toBe("xlsx");
  });

  it("is case-insensitive on extension", () => {
    expect(classifyFormat({ filename: "DATA.CSV" })).toBe("csv");
  });

  it("trims the filename before matching", () => {
    expect(classifyFormat({ filename: "  data.csv  " })).toBe("csv");
  });

  it("rejects an unsupported extension", () => {
    let error: unknown;
    try {
      classifyFormat({ filename: "report.pdf" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(FileSignatureError);
    expect((error as FileSignatureError).code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects a filename with no extension", () => {
    expect(() => classifyFormat({ filename: "noextension" })).toThrow(FileSignatureError);
  });

  it("never consults MIME type", () => {
    // classifyFormat's own input type carries only `filename` — there is
    // no MIME field to even pass, which is itself the proof: a lying MIME
    // cannot influence this function because it structurally cannot reach it.
    expect(classifyFormat({ filename: "data.csv" })).toBe("csv");
  });
});

// ─── validateSignature ─────────────────────────────────────────────────

describe("fileSignatures — validateSignature", () => {
  it("accepts a byte buffer with a valid ZIP signature for xlsx", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(() => validateSignature("xlsx", bytes)).not.toThrow();
  });

  it("rejects an xlsx-classified buffer without a ZIP signature", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    let error: unknown;
    try {
      validateSignature("xlsx", bytes);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(FileSignatureError);
    expect((error as FileSignatureError).code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("accepts a byte buffer with a valid OLE/CFB signature for xls", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    expect(() => validateSignature("xls", bytes)).not.toThrow();
  });

  it("rejects an xls-classified buffer without an OLE signature", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => validateSignature("xls", bytes)).toThrow(FileSignatureError);
  });

  it("accepts CSV bytes with no NUL bytes", () => {
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    expect(() => validateSignature("csv", bytes)).not.toThrow();
  });

  it("rejects CSV bytes containing a NUL byte", () => {
    const bytes = new Uint8Array([0x61, 0x00, 0x62]);
    let error: unknown;
    try {
      validateSignature("csv", bytes);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(FileSignatureError);
    expect((error as FileSignatureError).code).toBe("INVALID_FILE_SIGNATURE");
  });
});

// ─── matchesSignature / containsNulByte (raw helpers) ──────────────────

describe("fileSignatures — matchesSignature", () => {
  it("true for an exact prefix match", () => {
    expect(matchesSignature(new Uint8Array([1, 2, 3, 4]), [1, 2, 3])).toBe(true);
  });

  it("false for a mismatched prefix", () => {
    expect(matchesSignature(new Uint8Array([1, 2, 9, 4]), [1, 2, 3])).toBe(false);
  });

  it("false when the buffer is shorter than the signature", () => {
    expect(matchesSignature(new Uint8Array([1, 2]), [1, 2, 3])).toBe(false);
  });

  it("the exported ZIP_SIGNATURE matches a real ZIP local-file-header prefix", () => {
    expect(matchesSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), ZIP_SIGNATURE)).toBe(true);
  });

  it("the exported OLE_SIGNATURE matches a real OLE/CFB prefix", () => {
    expect(
      matchesSignature(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), OLE_SIGNATURE)
    ).toBe(true);
  });
});

// ─── Canonical source limit single-sourcing (Step 4) ──────────────────

describe("canonical source limit — single-sourced", () => {
  it("lib/data-hub/limits.ts defines exactly one canonical MAX_SOURCE_FILE_BYTES = 20 MiB", () => {
    const code = read("lib/data-hub/limits.ts");
    expect(code).toMatch(/export const MAX_SOURCE_FILE_BYTES = 20 \* 1024 \* 1024/);
  });

  it("workbookParser.ts's DEFAULT_WORKBOOK_LIMITS.maxOriginalBytes is sourced from MAX_SOURCE_FILE_BYTES, never a duplicate inline literal", () => {
    const code = read("lib/data-hub/workbookParser.ts");
    // Import present.
    expect(code).toMatch(/import \{ MAX_SOURCE_FILE_BYTES \} from ["']\.\/limits["']/);
    // The DEFAULT_WORKBOOK_LIMITS object's maxOriginalBytes field must
    // reference the imported constant, not a duplicate `20 * 1024 * 1024`
    // (or any other numeric) literal.
    const block = code.match(/export const DEFAULT_WORKBOOK_LIMITS[\s\S]*?\};/)?.[0] ?? "";
    expect(block).toMatch(/maxOriginalBytes:\s*MAX_SOURCE_FILE_BYTES/);
    expect(block).not.toMatch(/maxOriginalBytes:\s*20\s*\*\s*1024\s*\*\s*1024/);
  });

  it("actually resolves to the same numeric value at runtime", async () => {
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const { DEFAULT_WORKBOOK_LIMITS } = await import("@/lib/data-hub/workbookParser");
    expect(DEFAULT_WORKBOOK_LIMITS.maxOriginalBytes).toBe(MAX_SOURCE_FILE_BYTES);
  });

  it("workbookArchiveGuard.ts's maxCompressedEntryBytes remains its OWN independently-declared constant, never imported from limits.ts", () => {
    const code = read("lib/data-hub/workbookArchiveGuard.ts");
    expect(code).not.toMatch(/from ["']\.\/limits["']/);
    expect(code).not.toMatch(/MAX_SOURCE_FILE_BYTES/);
    // It still declares its own 20 MiB value independently.
    expect(code).toMatch(/maxCompressedEntryBytes:\s*20\s*\*\s*1024\s*\*\s*1024/);
  });
});

describe("fileSignatures — containsNulByte", () => {
  it("false for a buffer with no NUL bytes", () => {
    expect(containsNulByte(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("true for a buffer containing a NUL byte anywhere", () => {
    expect(containsNulByte(new Uint8Array([1, 0, 3]))).toBe(true);
  });

  it("false for an empty buffer", () => {
    expect(containsNulByte(new Uint8Array([]))).toBe(false);
  });
});
