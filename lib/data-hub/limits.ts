// Data Hub 5A.2G.1 — canonical original/source-file size limit.
//
// This is the single source of truth for the maximum byte size of the
// ORIGINAL, on-disk source file a caller may upload through the direct
// browser-to-private-Blob protocol (initiate/finalize). It is deliberately
// a standalone module with zero other imports so every consumer — the
// workbook parser, the direct-upload token signer, the finalize byte/size
// preflight — can depend on it without pulling in anything else.
//
// This value is NOT the same thing as workbookArchiveGuard.ts's own
// independently-declared archive/entry-count/decompressed-byte limits
// (ArchiveLimits / DEFAULT_ARCHIVE_LIMITS) — those bound the XLSX ZIP
// archive's internal entries after the file has already passed this
// original-file-size gate, and are semantically distinct even where a
// specific number (its maxCompressedEntryBytes) happens to also be 20 MiB
// today. Do not merge or cross-reference the two constants; each is owned
// by its own module.
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB
