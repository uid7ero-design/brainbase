import { afterEach, describe, expect, it, vi } from "vitest";
import { preparationRequest } from "@/lib/data-hub/client/preparation";
const signal = new AbortController().signal;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
describe("preparation transport", () => {
  it.each(["PRIVATE_PROVIDER_DETAIL", "NOT_READY", "FAILED"])("rejects a posted non-completion: %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, status })));
    await expect(preparationRequest("upload", "stage", "POST", signal)).rejects.toThrow("RESPONSE_INVALID");
  });
  it("rejects RUNNING with a misleading HTTP success status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, status: "RUNNING" }, 200)));
    await expect(preparationRequest("upload", "profile", "POST", signal)).rejects.toThrow("RESPONSE_INVALID");
  });
  it.each([undefined, null, -1, "4", 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects malformed completed profile column counts: %s", async columnCount => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, status: "SUCCEEDED", rowCount: 0, columnCount })));
    await expect(preparationRequest("upload", "profile", "GET", signal)).rejects.toThrow("RESPONSE_INVALID");
  });
  it("maps unknown provider codes to fixed recovery text references", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: false, code: "PRIVATE_DATABASE_VALUE", detail: "private" }, 503)));
    await expect(preparationRequest("upload", "profile", "POST", signal)).rejects.toThrow("PREPARATION_FAILED");
  });
  it("preserves a genuine zero completed row count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, status: "SUCCEEDED", rowCount: 0, columnCount: 4 })));
    expect(await preparationRequest("upload", "profile", "GET", signal)).toEqual({ status: "SUCCEEDED", rowCount: 0 });
  });
});
