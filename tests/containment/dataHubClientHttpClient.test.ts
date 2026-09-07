import { describe, it, expect, vi } from "vitest";
import {
  initiateImportBatch,
  finalizeImportBatch,
  getImportBatch,
  inspectCsvWorksheet,
  listWorksheetsForBatch,
  confirmIllegalDumping,
} from "@/lib/data-hub/client/httpClient";

// Data Hub 5A.3B — behavioral tests for the typed fetch transport layer.
// Disposable/mocked only: a fake `fetch` implementation is injected via
// `fetchImpl` (httpClient.ts's own designed seam) — no real network call,
// no real Postgres, no real Blob store anywhere in this file.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("httpClient — transport classification", () => {
  it("classifies a normal 200 JSON response as kind:'response'", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { batch: { id: "b1" }, uploadToken: "tok", configurationError: false }));
    const result = await initiateImportBatch(
      { originalFilename: "x.csv", declaredSizeBytes: 10, idempotencyKey: "key-1" },
      { fetchImpl }
    );
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.httpStatus).toBe(200);
      expect("uploadToken" in result.body && result.body.uploadToken).toBe("tok");
    }
  });

  it("sends Idempotency-Key as a header, never in the JSON body", async () => {
    // Assertions are made AFTER the call completes, deliberately never
    // inside the fetchImpl mock body itself: httpClient.ts's own
    // executeCall wraps every `await fetchImpl(...)` call in a try/catch
    // that reclassifies ANY thrown error (including a failed `expect()`
    // assertion thrown from inside this mock) as "networkUncertain" — an
    // assertion thrown inside the mock would be silently swallowed by the
    // code under test rather than failing the test, which would make this
    // test unable to actually detect a header/body-shape regression. This
    // was verified for real: see this phase's own mutation-testing record
    // (M1) for the false-pass this exact mistake produced before being
    // caught and fixed.
    let capturedHeaders: Headers | null = null;
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      return jsonResponse(200, { batch: { id: "b1" }, uploadToken: null, configurationError: false });
    });
    await initiateImportBatch(
      { originalFilename: "x.csv", declaredSizeBytes: 10, idempotencyKey: "my-key-123" },
      { fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("Idempotency-Key")).toBe("my-key-123");
    const parsedBody = JSON.parse(capturedBody ?? "{}");
    expect(parsedBody.idempotencyKey).toBeUndefined();
  });

  it("classifies a thrown fetch rejection as networkUncertain, never as a domain failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await finalizeImportBatch("batch-1", { fetchImpl });
    expect(result.kind).toBe("networkUncertain");
    if (result.kind === "networkUncertain") {
      expect(result.reason).toBe("networkError");
    }
  });

  it("classifies a timeout as networkUncertain with reason 'timeout', not a failure", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const result = await finalizeImportBatch("batch-1", { fetchImpl, timeoutMs: 20 });
    expect(result.kind).toBe("networkUncertain");
    if (result.kind === "networkUncertain") {
      expect(result.reason).toBe("timeout");
    }
  });

  it("classifies a caller-triggered AbortSignal as networkUncertain with reason 'aborted'", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const promise = getImportBatch("batch-1", { fetchImpl, timeoutMs: 5000 }, { signal: controller.signal });
    controller.abort();
    const result = await promise;
    expect(result.kind).toBe("networkUncertain");
    if (result.kind === "networkUncertain") {
      expect(result.reason).toBe("aborted");
    }
  });

  it("classifies a non-JSON body as malformed, never guessed into a domain shape", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>not json</html>", { status: 200 }));
    const result = await inspectCsvWorksheet("batch-1", { fetchImpl });
    expect(result.kind).toBe("malformed");
  });

  it("classifies an empty body as malformed", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const result = await listWorksheetsForBatch("batch-1", { fetchImpl });
    expect(result.kind).toBe("malformed");
  });

  it("preserves httpStatus on an error response body without treating it as network-level uncertainty", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: "conflict" }));
    const result = await confirmIllegalDumping("worksheet-1", { fetchImpl });
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.httpStatus).toBe(409);
      expect("error" in result.body && result.body.error).toBe("conflict");
    }
  });

  it("builds URLs with the configured baseUrl prefix and encodes path segments", async () => {
    // Captured and asserted AFTER the call — see the header comment on the
    // "sends Idempotency-Key" test above for why an `expect()` inside the
    // mock body itself would be silently swallowed rather than failing.
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse(200, { ok: true, outcome: "READY", batchId: "a/b", sha256: "x" });
    });
    await finalizeImportBatch("a/b", { fetchImpl, baseUrl: "https://example.test" });
    expect(capturedUrl).toBe("https://example.test/api/data-hub/import-batches/a%2Fb/finalize");
  });
});
