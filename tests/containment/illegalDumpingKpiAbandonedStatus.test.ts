import { describe, it, expect, vi, beforeEach } from "vitest";

// Data Hub 6.1C2 — mocked-execution proof for app/api/illegal-dumping/kpi/
// route.ts's corrected resolved-count calculation. Proves ABANDONED is
// never counted as resolved, even when resolution_date is populated
// (the exact real-world Onkaparinga shape — a Closed timestamp on an
// abandoned record), while every pre-existing CLOSED/resolution_date
// behavior for other statuses is completely unaffected. Mirrors this
// repo's established vi.mock("@/lib/prisma", ...) + vi.resetModules()
// pattern (see tests/containment/confirmWorksheet.test.ts).

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    illegalDumping: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

vi.mock("@/lib/authSession", () => ({
  getAuthSession: vi.fn(async () => ({
    userId: "user-a",
    organisationId: "org-a",
    role: "manager",
    name: "Test User",
    email: "test@example.com",
  })),
}));

async function freshRoute() {
  vi.resetModules();
  return import("@/app/api/illegal-dumping/kpi/route");
}

function incident(overrides: Partial<{ status: string; resolution_date: Date | null; suburb: string | null; severity: string }> = {}) {
  return {
    status: "OPEN",
    resolution_date: null,
    suburb: null,
    severity: "MEDIUM",
    report_date: new Date("2026-01-01"),
    ...overrides,
  };
}

beforeEach(() => {
  findManyMock.mockReset();
});

describe("illegal-dumping KPI route — ABANDONED resolved-count correction (6.1C2)", () => {
  it("A. an ABANDONED row with a POPULATED resolution_date does NOT count as resolved", async () => {
    findManyMock.mockResolvedValue([incident({ status: "ABANDONED", resolution_date: new Date("2026-08-28") })]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.recoveryRate).toBe(0);
  });

  it("B. an ABANDONED row with a NULL resolution_date does NOT count as resolved", async () => {
    findManyMock.mockResolvedValue([incident({ status: "ABANDONED", resolution_date: null })]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.recoveryRate).toBe(0);
  });

  it("C. a CLOSED row (no resolution_date) still counts as resolved — regression", async () => {
    findManyMock.mockResolvedValue([incident({ status: "CLOSED", resolution_date: null })]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.recoveryRate).toBe(100);
  });

  it("D. a RESOLVED row still counts as resolved — regression (via the existing resolution_date fallback path when a resolution_date is present, since RESOLVED alone is not one of the two literal branches)", async () => {
    findManyMock.mockResolvedValue([incident({ status: "RESOLVED", resolution_date: new Date("2026-08-28") })]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.recoveryRate).toBe(100);
  });

  it("E. an OPEN row with a populated resolution_date STILL counts as resolved via the existing fallback — a deliberate, pre-existing, unrelated-to-this-fix behavior. The 6.1C2 fix narrows ONLY the ABANDONED case; this regression guard proves it doesn't narrow anything further.", async () => {
    findManyMock.mockResolvedValue([incident({ status: "OPEN", resolution_date: new Date("2026-08-28") })]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.recoveryRate).toBe(100);
  });

  it("G. mixed batch — total/resolved counts are correct with ABANDONED excluded from the numerator but included in the denominator", async () => {
    findManyMock.mockResolvedValue([
      incident({ status: "CLOSED" }),
      incident({ status: "ABANDONED", resolution_date: new Date("2026-08-28") }),
      incident({ status: "OPEN" }),
      incident({ status: "OPEN" }),
    ]);
    const { GET } = await freshRoute();
    const res = await GET(new Request("http://localhost/api/illegal-dumping/kpi"));
    const body = await res.json();
    expect(body.data.totalIncidents).toBe(4);
    expect(body.data.recoveryRate).toBe(25); // 1 of 4 resolved (CLOSED only)
  });
});
