import { beforeEach, describe, expect, it, vi } from "vitest";
const { requireRole } = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/app/data-hub/sources/runs-review/RunsPilotReviewClient", () => ({ default: () => null }));
import Page, { dynamic } from "@/app/data-hub/sources/runs-review/page";

beforeEach(() => { requireRole.mockReset(); });
describe("Runs draft review page access", () => {
  it("requires a fresh manager session before serving the collector", async () => {
    requireRole.mockResolvedValue({ organisationId: "synthetic-org" });
    expect(dynamic).toBe("force-dynamic");
    expect(await Page()).toBeTruthy(); expect(requireRole).toHaveBeenCalledExactlyOnceWith("manager");
  });
  it.each(["Unauthorized", "Forbidden"])("redirects %s without serving the collector", async message => {
    requireRole.mockRejectedValue(new Error(message));
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });
});
