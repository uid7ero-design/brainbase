import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfilePlanningClient from "@/app/data-hub/analysis/_components/ProfilePlanningClient";
import { planningFixture } from "../helpers/dataHubPlanningFixture";
import { buildReviewedProfileCountSelection } from "@/lib/data-hub/analysis/profileCountSelection";
import { PLANNING_REQUEST_TIMEOUT_MS } from "@/lib/data-hub/client/planningTransport";
import { axe } from "jest-axe";

const fetchMock = vi.fn(); const busy = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function view(f = planningFixture(), key = "initial") {
  return <ProfilePlanningClient key={key} uploadId="upload" review={f.review} fieldLabels={f.labels} disabled={false} onBusyChange={busy} />;
}
async function load() {
  fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
  await screen.findByRole("group", { name: "Requests to plan" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Plan selected requests" })).toBeEnabled());
}
describe("planning controls and request lifetimes", () => {
  it("releases busy controls on timeout without requiring the network to honor abort", async () => {
    vi.useFakeTimers(); fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    render(view()); fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PLANNING_REQUEST_TIMEOUT_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_TIMED_OUT");
    expect(screen.getByRole("button", { name: "Load planning choices" })).toBeEnabled();
    expect(busy).toHaveBeenLastCalledWith(false); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("cancels pending work immediately and ignores its late response after explicit recovery", async () => {
    const f = planningFixture(); let done!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { done = resolve; }));
    render(view(f)); fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel planning" }));
    await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_CANCELLED");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); expect(busy).toHaveBeenLastCalledWith(false);
    fetchMock.mockResolvedValueOnce(response(f.catalog())); await load();
    const foreign = f.catalog(); if (foreign.ok) foreign.catalog.context.uploadId = "foreign";
    await act(async () => { done(response(foreign)); });
    expect(screen.getByRole("group", { name: "Requests to plan" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("has accessible idle, selection and planned states", async () => {
    const f = planningFixture(); fetchMock.mockResolvedValueOnce(response(f.catalog())).mockResolvedValueOnce(response(f.planned()));
    const { container } = render(view(f)); expect(await axe(container)).toHaveNoViolations();
    await load(); expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByLabelText("Present values — Amount (field 1)"));
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" }));
    await screen.findByRole("region", { name: "Planned requests" }); expect(await axe(container)).toHaveNoViolations();
  });
  it("has accessible pending cancellation and recovery feedback", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(view()); fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Cancel planning" }));
    await screen.findByRole("alert"); expect(await axe(container)).toHaveNoViolations();
  });
  it("loads choices and submits only the profile pin/selection; planning never calls counts or saves", async () => {
    const f = planningFixture(); fetchMock.mockResolvedValueOnce(response(f.catalog())).mockResolvedValueOnce(response(f.planned()));
    render(view(f)); expect(fetchMock).not.toHaveBeenCalled();
    await load(); fireEvent.click(screen.getByLabelText("Present values — Amount (field 1)"));
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" }));
    await screen.findByRole("region", { name: "Planned requests" });
    expect(screen.getByText(/2 requests planned from saved review 3/)).toBeVisible();
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/data-hub/worksheets/upload/analysis-planning");
    expect(JSON.parse(options.body)).toEqual(f.body); expect(options.cache).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(busy).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText("Row count"));
    expect(screen.queryByRole("region", { name: "Planned requests" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("disambiguates duplicate labels, prevents empty/oversized selection and admits 20 measures without rows", async () => {
    const f = planningFixture(21); fetchMock.mockResolvedValue(response(f.catalog())); render(view(f)); await load();
    for (let index = 1; index <= 19; index++) fireEvent.click(screen.getByLabelText(`Present values — Amount (field ${index})`));
    expect(screen.getByLabelText("Present values — Amount (field 20)")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Row count"));
    fireEvent.click(screen.getByLabelText("Present values — Amount (field 20)"));
    expect(screen.getByLabelText("Row count")).toBeDisabled();
    expect(screen.getByText(/20 of 20 requests selected/)).toBeVisible();
    for (let index = 1; index <= 20; index++) fireEvent.click(screen.getByLabelText(`Present values — Amount (field ${index})`));
    expect(screen.getByRole("button", { name: "Plan selected requests" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["json", "revision", "scope", "unknown", "partial", "hold"])("clears prior plans and choices on %s denial/corruption", async kind => {
    const f = planningFixture(); fetchMock.mockResolvedValueOnce(response(f.catalog())).mockResolvedValueOnce(response(f.planned()));
    render(view(f)); await load(); fireEvent.click(screen.getByLabelText("Present values — Amount (field 1)"));
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" }));
    await screen.findByRole("region", { name: "Planned requests" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Plan selected requests" })).toBeEnabled());
    let value: unknown = f.planned();
    if (kind === "revision" && value && typeof value === "object") Object.assign(value, { reviewRevision: 4 });
    if (kind === "scope") { const result = f.planned(); if (result.ok) result.plans[0].context.uploadId = "other"; value = result; }
    if (kind === "unknown") value = { ok: false, code: "private diagnostic" };
    if (kind === "partial") value = { ok: false, code: "QUALITY_HOLD", plans: [] };
    if (kind === "hold") value = { ok: false, code: "QUALITY_HOLD", requestIndex: 0 };
    fetchMock.mockResolvedValueOnce(kind === "json" ? new Response("<html>private diagnostic</html>") : response(value));
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "Planned requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Requests to plan" })).not.toBeInTheDocument();
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(response(f.catalog())); await load();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("discards late responses from the prior review without unlocking the new request", async () => {
    const first = planningFixture(); const next = planningFixture(); next.review.revision = 4;
    let oldDone!: (value: Response) => void; let newDone!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { oldDone = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { newDone = resolve; }));
    const rendered = render(view(first, "3")); fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rendered.rerender(view(next, "4")); expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Load planning choices" }));
    await act(async () => { oldDone(response(first.catalog())); });
    expect(screen.queryByRole("group", { name: "Requests to plan" })).not.toBeInTheDocument();
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => { newDone(response(next.catalog())); });
    await screen.findByRole("group", { name: "Requests to plan" }); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("hides prior plans during a failed transport and does not accept success data on an error status", async () => {
    const f = planningFixture(); fetchMock.mockResolvedValueOnce(response(f.catalog())).mockResolvedValueOnce(response(f.planned(), 503));
    render(view(f)); await load(); fireEvent.click(screen.getByLabelText("Present values — Amount (field 1)"));
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" })); await screen.findByRole("alert");
    expect(screen.getByText("Reference: REQUEST_FAILED")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Planned requests" })).not.toBeInTheDocument();
  });
  it("does not load automatically or make a request for a held/disabled review", () => {
    const f = planningFixture(); f.review.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    render(view(f)); expect(screen.getByRole("button", { name: "Load planning choices" })).toBeDisabled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("copies selection intent before awaiting a response", async () => {
    const f = planningFixture(); fetchMock.mockResolvedValueOnce(response(f.catalog())); render(view(f)); await load();
    fireEvent.click(screen.getByLabelText("Present values — Amount (field 1)"));
    fetchMock.mockImplementationOnce((_url, options) => {
      const body = JSON.parse(options.body); return Promise.resolve(response(buildReviewedProfileCountSelection(f.context, f.review, body.selection)));
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan selected requests" }));
    await screen.findByRole("region", { name: "Planned requests" });
    expect(screen.getByLabelText("Present values — Amount (field 1)")).toBeChecked();
  });
});
