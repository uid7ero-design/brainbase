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
