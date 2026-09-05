import { describe, it, expect, vi, beforeEach } from "vitest";

// Data Hub 5A.3B — behavioral tests for the direct-to-Blob upload wrapper.
// The real "@vercel/blob/client" module is mocked (vi.mock) — this is the
// disposable/mocked-only test infrastructure this phase's spec calls for;
// never a real Blob store, never a real network call.

const putMock = vi.fn();
const getPayloadFromClientTokenMock = vi.fn();

vi.mock("@vercel/blob/client", () => ({
  put: (...args: unknown[]) => putMock(...args),
  getPayloadFromClientToken: (...args: unknown[]) => getPayloadFromClientTokenMock(...args),
}));

// Imported AFTER the mock is registered (vi.mock is hoisted by vitest, so
// static import order here doesn't actually matter, but this ordering
// keeps the file readable top-to-bottom).
import { uploadFileDirectToBlob, resolveUploadPathname } from "@/lib/data-hub/client/blobUpload";

function fakeToken(pathname: string): string {
  // Real tokens are "vercel_blob_client_<storeId>_<base64(json).sig>" — the
  // exact prefix format doesn't matter to this module (it only calls the
  // mocked getPayloadFromClientToken), so any opaque string is fine here.
  return `fake-token-for-${pathname}`;
}

beforeEach(() => {
  putMock.mockReset();
  getPayloadFromClientTokenMock.mockReset();
});

describe("blobUpload — pathname resolution", () => {
  it("resolves the pathname from the token's own decoded payload, never re-derives it", () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_abc/importbatch_def" });
    const pathname = resolveUploadPathname(fakeToken("org_abc/importbatch_def"));
    expect(pathname).toBe("org_abc/importbatch_def");
    expect(getPayloadFromClientTokenMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error if the decoded payload has no usable pathname (contract-drift guard)", () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "" });
    expect(() => resolveUploadPathname("bad-token")).toThrow(/pathname/);
  });
});

describe("blobUpload — uploadFileDirectToBlob", () => {
  const file = new File(["a,b,c\n1,2,3\n"], "test.csv", { type: "text/csv" });

  it("calls put() with access:'private', multipart:false, and the token-derived pathname", async () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_2" });
    putMock.mockResolvedValue({ url: "https://blob.example/x", downloadUrl: "https://blob.example/x?download=1", pathname: "org_1/importbatch_2", contentType: "text/csv", contentDisposition: "inline", etag: "abc" });

    const result = await uploadFileDirectToBlob({ file, uploadToken: "tok" });

    expect(result.ok).toBe(true);
    expect(putMock).toHaveBeenCalledTimes(1);
    const [pathnameArg, bodyArg, optionsArg] = putMock.mock.calls[0];
    expect(pathnameArg).toBe("org_1/importbatch_2");
    expect(bodyArg).toBe(file);
    expect(optionsArg.access).toBe("private");
    expect(optionsArg.multipart).toBe(false);
    expect(optionsArg.token).toBe("tok");
  });

  it("passes through onUploadProgress and abortSignal unchanged", async () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_2" });
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const onUploadProgress = vi.fn();
    const controller = new AbortController();

    await uploadFileDirectToBlob({ file, uploadToken: "tok", onUploadProgress, abortSignal: controller.signal });

    const optionsArg = putMock.mock.calls[0][2];
    expect(optionsArg.onUploadProgress).toBe(onUploadProgress);
    expect(optionsArg.abortSignal).toBe(controller.signal);
  });

  it("classifies an AbortError from put() as reason:'aborted', not 'uploadError'", async () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_2" });
    const abortErr = new Error("The user aborted a request.");
    abortErr.name = "AbortError";
    putMock.mockRejectedValue(abortErr);

    const result = await uploadFileDirectToBlob({ file, uploadToken: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("aborted");
  });

  it("classifies any other put() rejection as reason:'uploadError', carrying the SDK's own message verbatim", async () => {
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_2" });
    putMock.mockRejectedValue(new Error("Pathname mismatch, expected X. Check the pathname used in upload() or put() matches the one from the client token."));

    const result = await uploadFileDirectToBlob({ file, uploadToken: "tok" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("uploadError");
      expect(result.message).toMatch(/Pathname mismatch/);
    }
  });
});
