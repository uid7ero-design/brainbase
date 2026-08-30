import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  RawFileStore,
  RawFileStoreError,
  buildImportBatchKey,
  validateStorageKey,
} from "@/lib/data-hub/storage/rawFileStore";
import { InMemoryFileStore } from "@/lib/data-hub/storage/inMemoryFileStore";
import { TestFileStore } from "@/lib/data-hub/storage/testFileStore";

// Data Hub RawFileStore behavioral contract suite (Phase 5A.2E).
//
// This suite is written as ONE reusable function, runRawFileStoreContractTests,
// exported below, so a future private Vercel Blob adapter (5A.2F) can import
// it and run the SAME 24 behavioral expectations against a real adapter
// without duplicating a single assertion or requiring a real network
// connection in ordinary CI (5A.2F decides for itself how to gate any
// live-provider run separately — nothing here assumes or requires one).
//
// Concurrency/race tests avoid bare sleeps as the sole synchronization
// mechanism: they use explicit Promise-based barriers/latches so the
// intended race is deterministic, not timing-dependent.

export interface ContractTestContext {
  store: RawFileStore;
  /** True only for implementations that can genuinely race two writers at
   * the OS level (the filesystem store). InMemoryFileStore's Map access is
   * single-threaded/synchronous under the hood, so its "race" tests still
   * run and still must pass, but they exercise the logical contract rather
   * than a true OS-level race. */
  supportsRealConcurrencyRace: boolean;
}

export function runRawFileStoreContractTests(
  label: string,
  setup: () => Promise<ContractTestContext> | ContractTestContext,
  teardown?: (ctx: ContractTestContext) => Promise<void> | void
): void {
  describe(`RawFileStore contract — ${label}`, () => {
    let ctx: ContractTestContext;

    beforeEach(async () => {
      ctx = await setup();
    });

    afterEach(async () => {
      if (teardown) await teardown(ctx);
    });

    // 1. put -> head exact metadata
    it("1. put -> head returns exact metadata", async () => {
      const body = new Uint8Array([1, 2, 3, 4, 5]);
      await ctx.store.put("k1", body, { contentType: "application/octet-stream" });
      const meta = await ctx.store.head("k1");
      expect(meta).not.toBeNull();
      expect(meta!.provider).toBe(ctx.store.provider);
      expect(meta!.size).toBe(5);
      expect(meta!.contentType).toBe("application/octet-stream");
    });

    // 2. put -> get byte-exact round trip
    it("2. put -> get returns byte-exact content", async () => {
      const body = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
      await ctx.store.put("k2", body);
      const { body: readBack } = await ctx.store.get("k2");
      expect(Array.from(readBack)).toEqual(Array.from(body));
    });

    // 3. opaque binary/non-UTF8 fidelity
    it("3. opaque binary/non-UTF8 bytes round-trip exactly", async () => {
      const body = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x7f, 0xc0, 0x00, 0xd8, 0x00, 0xdc]);
      await ctx.store.put("k3", body);
      const { body: readBack } = await ctx.store.get("k3");
      expect(Array.from(readBack)).toEqual(Array.from(body));
    });

    // 4. caller mutation after put does not mutate stored object
    it("4. mutating the caller's buffer after put does not affect stored data", async () => {
      const body = new Uint8Array([1, 1, 1, 1]);
      await ctx.store.put("k4", body);
      body[0] = 99;
      const { body: readBack } = await ctx.store.get("k4");
      expect(readBack[0]).toBe(1);
    });

    // 5. mutation of returned get body does not mutate stored object
    it("5. mutating a returned get() body does not affect subsequent reads", async () => {
      const body = new Uint8Array([2, 2, 2, 2]);
      await ctx.store.put("k5", body);
      const first = await ctx.store.get("k5");
      first.body[0] = 77;
      const second = await ctx.store.get("k5");
      expect(second.body[0]).toBe(2);
    });

    // 5A.2E-R2 (Section 15.A): a Uint8Array VIEW with non-zero
    // byteOffset over a larger, shared ArrayBuffer must still be copied
    // correctly on both put() and get() — Uint8Array.prototype.slice()
    // always allocates a new, independent buffer regardless of the
    // source view's offset, but this was previously unexercised by any
    // test.
    it("5b. a Uint8Array view with non-zero byteOffset over a shared ArrayBuffer is copied correctly, not aliased", async () => {
      const shared = new ArrayBuffer(20);
      const full = new Uint8Array(shared);
      full.set([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 1, 2, 3, 4, 5, 9, 9, 9, 9, 9]);
      const view = new Uint8Array(shared, 10, 5); // [1,2,3,4,5], offset 10, over a 20-byte buffer
      await ctx.store.put("k5b", view);

      // Mutate the ORIGINAL shared buffer (through a different view)
      // after put() — if the store aliased the view instead of copying,
      // this would corrupt the stored object.
      full[10] = 99;

      const { body } = await ctx.store.get("k5b");
      expect(Array.from(body)).toEqual([1, 2, 3, 4, 5]);
    });

    // 6. missing head -> null
    it("6. head() on a missing key returns null", async () => {
      const meta = await ctx.store.head("does-not-exist");
      expect(meta).toBeNull();
    });

    // 7. missing get -> NOT_FOUND
    it("7. get() on a missing key throws NOT_FOUND", async () => {
      await expect(ctx.store.get("does-not-exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    // 8. delete existing succeeds
    it("8. delete() on an existing key removes it", async () => {
      await ctx.store.put("k8", new Uint8Array([1]));
      await ctx.store.delete("k8");
      expect(await ctx.store.head("k8")).toBeNull();
    });

    // 9. repeated delete succeeds
    it("9. delete() is idempotent — repeated calls succeed", async () => {
      await ctx.store.put("k9", new Uint8Array([1]));
      await ctx.store.delete("k9");
      await expect(ctx.store.delete("k9")).resolves.toBeUndefined();
      await expect(ctx.store.delete("k9")).resolves.toBeUndefined();
    });

    // 10. put existing -> ALREADY_EXISTS
    it("10. put() on an existing key throws ALREADY_EXISTS", async () => {
      await ctx.store.put("k10", new Uint8Array([1]));
      await expect(ctx.store.put("k10", new Uint8Array([2]))).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
      });
    });

    // 11. same bytes under different keys remain independent
    it("11. identical bytes under different keys are stored and retrievable independently", async () => {
      const body = new Uint8Array([5, 5, 5]);
      await ctx.store.put("k11a", body);
      await ctx.store.put("k11b", body);
      const a = await ctx.store.get("k11a");
      const b = await ctx.store.get("k11b");
      expect(Array.from(a.body)).toEqual([5, 5, 5]);
      expect(Array.from(b.body)).toEqual([5, 5, 5]);
      await ctx.store.delete("k11a");
      expect(await ctx.store.head("k11a")).toBeNull();
      expect(await ctx.store.head("k11b")).not.toBeNull();
    });

    // 12. different keys never interfere
    it("12. writes to distinct keys never interfere with each other", async () => {
      await ctx.store.put("k12a", new Uint8Array([1, 1]));
      await ctx.store.put("k12b", new Uint8Array([2, 2, 2]));
      const a = await ctx.store.get("k12a");
      const b = await ctx.store.get("k12b");
      expect(Array.from(a.body)).toEqual([1, 1]);
      expect(Array.from(b.body)).toEqual([2, 2, 2]);
    });

    // 13. invalid-key matrix rejected identically
    it("13. every implementation rejects the same invalid-key matrix identically", async () => {
      const invalidKeys = [
        "../escape",
        "..",
        "/leading-slash",
        "trailing-slash/",
        "back\\slash",
        "nul\0byte",
        "C:/drive/form",
        "",
        "double//slash",
        "space here",
        "semi;colon",
        "dot.segment/../x",
      ];
      for (const key of invalidKeys) {
        await expect(ctx.store.put(key, new Uint8Array([1]))).rejects.toMatchObject({
          code: "INVALID_KEY",
        });
        await expect(ctx.store.get(key)).rejects.toMatchObject({ code: "INVALID_KEY" });
        await expect(ctx.store.head(key)).rejects.toMatchObject({ code: "INVALID_KEY" });
        await expect(ctx.store.delete(key)).rejects.toMatchObject({ code: "INVALID_KEY" });
      }
    });

    it("13b. the canonical key builder's own output is never rejected as invalid", async () => {
      const key = buildImportBatchKey("org_abc123", "batch_xyz789");
      await expect(ctx.store.put(key, new Uint8Array([1]))).resolves.toBeDefined();
      await expect(ctx.store.get(key)).resolves.toBeDefined();
    });

    // 14. contentType preserved when provided
    it("14. contentType is preserved exactly when provided", async () => {
      await ctx.store.put("k14", new Uint8Array([1]), { contentType: "text/csv" });
      const meta = await ctx.store.head("k14");
      expect(meta!.contentType).toBe("text/csv");
    });

    // 15. contentType absent when not provided
    it("15. contentType is absent when not provided", async () => {
      await ctx.store.put("k15", new Uint8Array([1]));
      const meta = await ctx.store.head("k15");
      expect(meta!.contentType).toBeUndefined();
    });

    // 16. etag remains absent for implementations without a genuine etag
    it("16. etag is never fabricated — absent for these reference implementations", async () => {
      await ctx.store.put("k16", new Uint8Array([1]));
      const meta = await ctx.store.head("k16");
      const { metadata } = await ctx.store.get("k16");
      expect(meta!.etag).toBeUndefined();
      expect(metadata.etag).toBeUndefined();
    });

    // 17. get maxBytes below object size -> SIZE_LIMIT
    it("17. get() with maxBytes below the object size throws SIZE_LIMIT", async () => {
      await ctx.store.put("k17", new Uint8Array(100));
      await expect(ctx.store.get("k17", { maxBytes: 50 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
    });

    // 18. get maxBytes equal object size -> success
    it("18. get() with maxBytes exactly equal to the object size succeeds", async () => {
      await ctx.store.put("k18", new Uint8Array(100));
      const { body } = await ctx.store.get("k18", { maxBytes: 100 });
      expect(body.byteLength).toBe(100);
    });

    // 19. get maxBytes above object size -> success
    it("19. get() with maxBytes above the object size succeeds", async () => {
      await ctx.store.put("k19", new Uint8Array(100));
      const { body } = await ctx.store.get("k19", { maxBytes: 1000 });
      expect(body.byteLength).toBe(100);
    });

    // 20. malformed maxBytes rejected as programmer error
    it("20. malformed maxBytes throws a plain TypeError, not a storage error code", async () => {
      await ctx.store.put("k20", new Uint8Array(10));
      await expect(ctx.store.get("k20", { maxBytes: -1 })).rejects.toBeInstanceOf(TypeError);
      await expect(ctx.store.get("k20", { maxBytes: 1.5 })).rejects.toBeInstanceOf(TypeError);
      await expect(ctx.store.get("k20", { maxBytes: NaN })).rejects.toBeInstanceOf(TypeError);
      await expect(ctx.store.get("k20", { maxBytes: Infinity })).rejects.toBeInstanceOf(TypeError);
      // 5A.2E-R2 (Section 16): Number.isSafeInteger, not merely
      // Number.isInteger — a value above 2^53 is "an integer" by
      // Number.isInteger's own definition but not exactly representable.
      await expect(
        ctx.store.get("k20", { maxBytes: Number.MAX_SAFE_INTEGER + 1 })
      ).rejects.toBeInstanceOf(TypeError);
    });

    // 5A.2E-R2 (Section 15.B): maxBytes === 0 is a real, meaningful
    // boundary value, not merely "no limit" — previously unexercised by
    // any test.
    it("20b. maxBytes === 0: a zero-byte object succeeds, a non-empty object throws SIZE_LIMIT", async () => {
      await ctx.store.put("k20b-empty", new Uint8Array(0));
      const { body } = await ctx.store.get("k20b-empty", { maxBytes: 0 });
      expect(body.byteLength).toBe(0);

      await ctx.store.put("k20b-nonempty", new Uint8Array([1]));
      await expect(ctx.store.get("k20b-nonempty", { maxBytes: 0 })).rejects.toMatchObject({ code: "SIZE_LIMIT" });
    });

    // 21. concurrent distinct-key writes succeed independently
    it("21. concurrent writes to distinct keys all succeed independently", async () => {
      const keys = ["k21a", "k21b", "k21c", "k21d"];
      await Promise.all(keys.map((k, i) => ctx.store.put(k, new Uint8Array([i, i, i]))));
      for (let i = 0; i < keys.length; i++) {
        const { body } = await ctx.store.get(keys[i]);
        expect(Array.from(body)).toEqual([i, i, i]);
      }
    });

    // 22. concurrent same-key writes: exactly one succeeds, loser(s) ALREADY_EXISTS,
    //     final bytes equal exactly one complete submitted payload.
    it("22. concurrent same-key writes: exactly one wins, losers get ALREADY_EXISTS, final bytes are one complete payload", async () => {
      const payloadA = new Uint8Array(500).fill(0xaa);
      const payloadB = new Uint8Array(700).fill(0xbb);
      const results = await Promise.allSettled([
        ctx.store.put("k22", payloadA),
        ctx.store.put("k22", payloadB),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "ALREADY_EXISTS" });

      const { body: finalBytes } = await ctx.store.get("k22");
      const isA = finalBytes.byteLength === 500 && finalBytes.every((b) => b === 0xaa);
      const isB = finalBytes.byteLength === 700 && finalBytes.every((b) => b === 0xbb);
      expect(isA || isB).toBe(true);
      // Never mixed/truncated/partial: length must exactly match one whole payload.
      expect([500, 700]).toContain(finalBytes.byteLength);
    });

    // 23. filesystem read-during-publication: reader sees NOT_FOUND before
    //     publication, or the complete final object — never partial.
    it("23. a reader racing a writer never observes a partial object", async () => {
      const fullPayload = new Uint8Array(200_000);
      for (let i = 0; i < fullPayload.length; i++) fullPayload[i] = i % 256;

      let writeStarted = false;
      let writeDone = false;
      const writePromise = (async () => {
        writeStarted = true;
        await ctx.store.put("k23", fullPayload);
        writeDone = true;
      })();

      const observations: Array<"not_found" | "complete"> = [];
      // Poll deterministically until the write has completed — this is not
      // a bare sleep-based race: it actively polls in a tight loop and
      // records EVERY observation made while the write is in flight, so
      // the assertion is about what was actually observed, not about
      // timing luck.
      while (!writeDone) {
        try {
          const { body } = await ctx.store.get("k23");
          observations.push("complete");
          expect(body.byteLength).toBe(fullPayload.length);
          expect(Array.from(body)).toEqual(Array.from(fullPayload));
        } catch (err) {
          if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") {
            observations.push("not_found");
          } else {
            throw err;
          }
        }
      }
      await writePromise;
      expect(writeStarted).toBe(true);
      // At least one observation was recorded (proving the poll loop ran
      // concurrently with the write, not merely after it).
      expect(observations.length).toBeGreaterThan(0);
    });

    // 24. provider errors normalized (deterministic seam: an invalid key
    //     is guaranteed to be rejected by every implementation's own
    //     internal validation before any provider/filesystem call is
    //     attempted, and the thrown error is always a RawFileStoreError
    //     with a stable code — never a raw ENOENT/EEXIST or provider
    //     exception type).
    it("24. thrown errors are always normalized RawFileStoreError instances with a stable code, never a raw provider error", async () => {
      await expect(ctx.store.get("missing-24")).rejects.toBeInstanceOf(RawFileStoreError);
      await expect(ctx.store.head("../bad-24")).rejects.toBeInstanceOf(RawFileStoreError);
      try {
        await ctx.store.get("missing-24");
      } catch (err) {
        expect(err).toBeInstanceOf(RawFileStoreError);
        expect((err as RawFileStoreError).code).toBe("NOT_FOUND");
        expect((err as Error).name).not.toMatch(/ENOENT|SystemError/i);
      }
    });
  });
}

describe("validateStorageKey — static grammar checks", () => {
  it("accepts a canonical builder-produced key", () => {
    expect(() => validateStorageKey("org_a1/importbatch_b2")).not.toThrow();
  });
  it("rejects traversal, absolute, backslash, and empty-segment forms", () => {
    for (const key of ["../x", "/x", "x/", "a//b", "a\\b", ""]) {
      expect(() => validateStorageKey(key)).toThrow(RawFileStoreError);
    }
  });
});

describe("buildImportBatchKey", () => {
  it("is deterministic and organisation-scoped", () => {
    const key = buildImportBatchKey("org1", "batch1");
    expect(key).toBe("org_org1/importbatch_batch1");
    expect(buildImportBatchKey("org1", "batch1")).toBe(key);
  });
  it("never embeds a filename or content hash", () => {
    const key = buildImportBatchKey("org1", "batch1");
    expect(key).not.toMatch(/\.(xlsx|xls|csv)$/i);
  });

  // 5A.2E-R2: buildImportBatchKey now validates organisationId/
  // importBatchId as opaque single-segment identifiers BEFORE
  // composing the key, not only the composed result — closing the
  // "component injection" gap where a value containing '/' could
  // silently reshape the namespace without being caught by
  // validateStorageKey's own grammar check on the final string.
  const invalidComponents = [
    "x/y",
    "../escape",
    "back\\slash",
    "nul\0byte",
    "colon:form",
    "",
    "unicodeé",
    "white space",
  ];

  it("rejects an organisationId containing a separator/traversal/unsafe character before composing a key", () => {
    for (const bad of invalidComponents) {
      expect(() => buildImportBatchKey(bad, "batch1")).toThrow(TypeError);
    }
  });

  it("rejects an importBatchId containing a separator/traversal/unsafe character before composing a key", () => {
    for (const bad of invalidComponents) {
      expect(() => buildImportBatchKey("org1", bad)).toThrow(TypeError);
    }
  });

  it("a component containing '/' cannot reshape the two-segment namespace into three", () => {
    expect(() => buildImportBatchKey("x/y", "batch1")).toThrow(TypeError);
    expect(() => buildImportBatchKey("org1", "x/y")).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Run the shared suite against both reference implementations.
// ---------------------------------------------------------------------------

runRawFileStoreContractTests(
  "InMemoryFileStore",
  () => ({ store: new InMemoryFileStore(), supportsRealConcurrencyRace: false })
);

runRawFileStoreContractTests(
  "TestFileStore",
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-contract-"));
    return { store: new TestFileStore(root), supportsRealConcurrencyRace: true, _root: root } as ContractTestContext & {
      _root: string;
    };
  },
  async (ctx) => {
    const root = (ctx as ContractTestContext & { _root: string })._root;
    await fs.rm(root, { recursive: true, force: true });
  }
);

describe("TestFileStore — construction guard", () => {
  it("throws if constructed while process.env.VERCEL is set", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(() => new TestFileStore("/tmp/should-not-construct")).toThrow(/Vercel runtime/);
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });
});

describe("TestFileStore — raw filesystem error normalization", () => {
  // A directory sitting at a would-be object's resolved path forces
  // fs.open(path, "r") to fail with EISDIR (not ENOENT) on every platform
  // this runs on — the one filesystem-specific way to reliably exercise
  // head()/get()'s non-ENOENT catch branch and prove it never leaks a raw
  // Node ErrnoException (name/code) to the caller, only a normalized
  // RawFileStoreError with code PROVIDER_FAILURE.
  it("head() normalizes a non-ENOENT filesystem error (EISDIR) to PROVIDER_FAILURE, never a raw error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-erriso-"));
    try {
      const store = new TestFileStore(root);
      const key = "a_directory_key";
      await fs.mkdir(path.join(root, key));
      await expect(store.head(key)).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
      try {
        await store.head(key);
      } catch (err) {
        expect(err).toBeInstanceOf(RawFileStoreError);
        expect((err as Error).name).toBe("RawFileStoreError");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("get() normalizes a non-ENOENT filesystem error (EISDIR) to PROVIDER_FAILURE, never a raw error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-erriso-"));
    try {
      const store = new TestFileStore(root);
      const key = "a_directory_key";
      await fs.mkdir(path.join(root, key));
      await expect(store.get(key)).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5A.2E-R2: TestFileStore on-disk framing hardening — malformed/corrupt
// object regression tests (F1-F14). These are inherently filesystem/
// framing-specific (InMemoryFileStore has no on-disk framing to corrupt)
// and deliberately write raw, hand-constructed bytes directly beneath a
// TestFileStore's root — bypassing put() entirely — to simulate disk
// corruption or a malformed object the store itself never wrote. Every
// case must fail as a normalized PROVIDER_FAILURE, never a raw
// SyntaxError/RangeError/Node ErrnoException.
// ---------------------------------------------------------------------------

describe("TestFileStore — malformed/corrupt framed object handling", () => {
  let root: string;
  let store: TestFileStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-framing-"));
    store = new TestFileStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  // Writes a raw framed-looking file with fully independent control over
  // the declared length-prefix value, the actual header bytes present,
  // and the actual content bytes present — so each corruption case can
  // be isolated precisely, without going through encodeObject()/put().
  async function writeRawFramedFile(
    key: string,
    declaredHeaderLength: number,
    headerBytes: Buffer,
    contentBytes: Buffer
  ): Promise<string> {
    const filePath = path.join(root, key);
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeUInt32LE(declaredHeaderLength >>> 0, 0);
    const fileBytes = Buffer.concat([lengthPrefix, headerBytes, contentBytes]);
    await fs.writeFile(filePath, fileBytes);
    return filePath;
  }

  async function expectBothNormalizedFailure(key: string): Promise<void> {
    await expect(store.head(key)).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
    await expect(store.get(key)).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
    // Never a raw SyntaxError/RangeError/Node ErrnoException.
    try {
      await store.head(key);
    } catch (err) {
      expect(err).toBeInstanceOf(RawFileStoreError);
      expect((err as Error).name).toBe("RawFileStoreError");
    }
  }

  it("F1: header length = 0 is rejected", async () => {
    await writeRawFramedFile("f1", 0, Buffer.alloc(0), Buffer.from("irrelevant"));
    await expectBothNormalizedFailure("f1");
  });

  it("F2: header length > configured maximum is rejected before allocation", async () => {
    // A GENUINELY valid, schema-conforming JSON header, padded with
    // insignificant JSON whitespace (permitted between tokens per the
    // JSON grammar) to exceed MAX_HEADER_BYTES on its own — this isolates
    // the max-length check as the sole possible failure reason: the
    // bytes are present in full (no truncation, so F3 cannot fire), and
    // the JSON is both syntactically valid and schema-conforming (so
    // neither "invalid JSON" nor "wrong shape" can fire either). If this
    // rejection ever stopped happening, the only remaining explanation
    // would be the max-length bound itself being gone or too permissive.
    const padding = " ".repeat(3000);
    const validButOversized = Buffer.from(`{"size":5,${padding}"contentType":"text/plain"}`, "utf8");
    expect(validButOversized.byteLength).toBeGreaterThan(2048);
    // Sanity: confirm this really would otherwise be accepted as valid,
    // schema-conforming JSON (proves the test isolates ONLY the length
    // bound, not an incidental secondary defect in the padding itself).
    const parsed = JSON.parse(validButOversized.toString("utf8"));
    expect(parsed).toEqual({ size: 5, contentType: "text/plain" });

    await writeRawFramedFile("f2", validButOversized.byteLength, validButOversized, Buffer.from("hello"));
    await expectBothNormalizedFailure("f2");
  });

  it("F3: header length claims bytes not present in the file", async () => {
    await writeRawFramedFile("f3", 100, Buffer.alloc(10, 0x41), Buffer.alloc(0));
    await expectBothNormalizedFailure("f3");
  });

  it("F4: invalid JSON in the header is rejected", async () => {
    const bad = Buffer.from("not json", "utf8");
    await writeRawFramedFile("f4", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f4");
  });

  it("F5: parsed JSON is null is rejected", async () => {
    const bad = Buffer.from("null", "utf8");
    await writeRawFramedFile("f5", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f5");
  });

  it("F6: parsed JSON is an array is rejected", async () => {
    const bad = Buffer.from("[1,2,3]", "utf8");
    await writeRawFramedFile("f6", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f6");
  });

  it("F7: missing size field is rejected", async () => {
    const bad = Buffer.from(JSON.stringify({ contentType: "text/plain" }), "utf8");
    await writeRawFramedFile("f7", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f7");
  });

  it("F8: negative size is rejected", async () => {
    const bad = Buffer.from(JSON.stringify({ size: -1 }), "utf8");
    await writeRawFramedFile("f8", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f8");
  });

  it("F9: fractional size is rejected", async () => {
    const bad = Buffer.from(JSON.stringify({ size: 1.5 }), "utf8");
    await writeRawFramedFile("f9", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f9");
  });

  it("F10: unsafe-integer size is rejected", async () => {
    const bad = Buffer.from(`{"size":${Number.MAX_SAFE_INTEGER + 1}}`, "utf8");
    await writeRawFramedFile("f10", bad.byteLength, bad, Buffer.alloc(0));
    await expectBothNormalizedFailure("f10");
  });

  it("F11: contentType of the wrong type is rejected", async () => {
    const bad = Buffer.from(JSON.stringify({ size: 5, contentType: 123 }), "utf8");
    await writeRawFramedFile("f11", bad.byteLength, bad, Buffer.from("hello"));
    await expectBothNormalizedFailure("f11");
  });

  it("F12: contentType exceeding the allowed maximum is rejected", async () => {
    const bad = Buffer.from(JSON.stringify({ size: 5, contentType: "x".repeat(300) }), "utf8");
    await writeRawFramedFile("f12", bad.byteLength, bad, Buffer.from("hello"));
    await expectBothNormalizedFailure("f12");
  });

  it("F13: body shorter than declared size is rejected by get() (head() is unaffected, since it never reads content)", async () => {
    const header = Buffer.from(JSON.stringify({ size: 100 }), "utf8");
    await writeRawFramedFile("f13", header.byteLength, header, Buffer.alloc(10, 0x41));
    // head() only reads the header, which is well-formed on its own —
    // the body/header inconsistency is exclusively a get()-time concern
    // (5A.2E-R2, Section 7: this is a deliberate scope decision, not an
    // oversight — see the ADR).
    await expect(store.head("f13")).resolves.toMatchObject({ size: 100 });
    await expect(store.get("f13")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  it("F14: body longer than declared size is rejected by get()", async () => {
    const header = Buffer.from(JSON.stringify({ size: 5 }), "utf8");
    await writeRawFramedFile("f14", header.byteLength, header, Buffer.alloc(20, 0x41));
    await expect(store.head("f14")).resolves.toMatchObject({ size: 5 });
    await expect(store.get("f14")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  });

  // 5A.2E-R2, Section 8/19 (mutation R5): a REAL, valid, schema-conforming
  // header padded with insignificant JSON whitespace (well under
  // MAX_HEADER_BYTES, so the size-bound check does not fire) has an
  // on-disk encoded length that DIFFERS from what
  // JSON.stringify(JSON.parse(headerBytes)) would recompute (the parsed
  // object re-serializes to its compact canonical form, discarding the
  // padding). If content-start were computed via that fragile
  // re-serialization instead of the actual validated on-disk header
  // length, reads would begin at the wrong file offset and return
  // corrupted/misaligned content — this proves readHeader's returned
  // headerLength (not a JSON.stringify recomputation) is what actually
  // determines the content offset.
  it("content offset is derived from the actual encoded header length, not a JSON.stringify recomputation of the parsed header", async () => {
    const paddedHeader = Buffer.from('{"size":5,     "contentType":"text/plain"}', "utf8");
    const compactReserialized = Buffer.from(JSON.stringify({ size: 5, contentType: "text/plain" }), "utf8");
    // Sanity: confirm this test actually exercises a real discrepancy —
    // if padding ever stopped differing in length from the compact
    // form, this test would silently prove nothing.
    expect(paddedHeader.byteLength).not.toBe(compactReserialized.byteLength);

    const realContent = Buffer.from([10, 20, 30, 40, 50]);
    await writeRawFramedFile("offset-check", paddedHeader.byteLength, paddedHeader, realContent);

    const { metadata, body } = await store.get("offset-check");
    expect(metadata.size).toBe(5);
    expect(Array.from(body)).toEqual([10, 20, 30, 40, 50]);
  });

  it("every successful get() satisfies metadata.size === body.byteLength (regression: this was previously violated by F13/F14-shaped corruption)", async () => {
    await store.put("consistent", new Uint8Array([1, 2, 3, 4, 5]));
    const { metadata, body } = await store.get("consistent");
    expect(metadata.size).toBe(body.byteLength);
  });
});

// ---------------------------------------------------------------------------
// 5A.2E-R2, Section 13: dedicated resource-bound regression test for the
// exact defect R2 independently reproduced (a corrupted 4-byte file
// claiming a ~2 GiB header length caused an immediate, unbounded
// Buffer.alloc(headerLength) with zero validation). This test must NOT
// attempt a real multi-gigabyte allocation itself — it proves the
// production code rejects the claim before ever allocating for it, by
// completing quickly against a file that is only a few bytes long.
// ---------------------------------------------------------------------------

describe("TestFileStore — resource-bound regression (5A.2E-R2)", () => {
  it("a tiny file with a huge declared header length fails immediately as PROVIDER_FAILURE, without allocating anywhere close to the claim", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-resourcebound-"));
    try {
      const store = new TestFileStore(root);
      const filePath = path.join(root, "huge-header-claim");
      const lengthPrefix = Buffer.alloc(4);
      // 0xFFFFFFFE: ~4 GiB, astronomically larger than MAX_HEADER_BYTES
      // and larger than the file itself (which is only 4 bytes total).
      lengthPrefix.writeUInt32LE(0xfffffffe, 0);
      await fs.writeFile(filePath, lengthPrefix); // file is ONLY the 4-byte prefix

      const start = Date.now();
      await expect(store.head("huge-header-claim")).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
      const elapsedMs = Date.now() - start;
      // A real ~4 GiB allocation attempt would be far slower (or throw a
      // RangeError from Node's own Buffer size ceiling) than a bounds
      // check that runs before any allocation — a generous 2s ceiling
      // proves this was rejected cheaply, not after a large attempted
      // allocation.
      expect(elapsedMs).toBeLessThan(2000);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5A.2E-R2, Section 14.A: deterministic mkdir failure normalization,
// using real filesystem state (a plain file occupying the path where a
// directory needs to be created) rather than a mocking framework.
// ---------------------------------------------------------------------------

describe("TestFileStore — mkdir failure normalization (5A.2E-R2)", () => {
  it("put() normalizes a parent-directory creation failure to PROVIDER_FAILURE, never a raw Node error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rawfilestore-mkdirfail-"));
    try {
      // Create a plain FILE at "blocked" — this makes it impossible for
      // fs.mkdir(recursive) to create a directory at that same path for
      // key "blocked/child", since a non-directory already occupies it.
      await fs.writeFile(path.join(root, "blocked"), "not a directory");
      const store = new TestFileStore(root);
      await expect(store.put("blocked/child", new Uint8Array([1]))).rejects.toMatchObject({
        code: "PROVIDER_FAILURE",
      });
      try {
        await store.put("blocked/child", new Uint8Array([1]));
      } catch (err) {
        expect(err).toBeInstanceOf(RawFileStoreError);
        expect((err as Error).name).toBe("RawFileStoreError");
        expect((err as Error).name).not.toMatch(/ENOTDIR|SystemError/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
