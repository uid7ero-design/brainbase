import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import MappingSetupClient from "@/app/data-hub/prepare/[uploadId]/mapping/MappingSetupClient";
import { createRunsPilotReview } from "@/lib/data-hub/schemaProfiles/runsPilotReview";

function approved() {
  const review = createRunsPilotReview(); review.missingPolicy = "NULL_ONLY";
  review.fields.forEach((f, i) => { f.confirmed = true; f.unit ??= i === 12 ? "kg" : "km";
    if (f.representation === "WHOLE_NUMBER") f.negativePolicy = "FORBID"; });
  return review;
}
const ready = () => ({ ok: true, kind: "SETUP", fingerprint: "a".repeat(64), version: 2, canSave: false, saved: true, confirmed: false, review: approved() });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); });
describe("saved mapping approval and first workbook use", () => {
  it("loads saved choices without writing and confirms only after an explicit workbook checkbox", async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => reply({ ...ready(), confirmed: options.method === "POST" }));
    vi.stubGlobal("fetch", fetcher); render(<MappingSetupClient uploadId="upload/a" />);
    await screen.findByText(/Mapping version 2/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/data-hub/worksheets/upload%2Fa/mapping-setup");
    const confirm = screen.getByRole("button", { name: "Confirm mapping for this workbook" }); expect(confirm).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Change saved mapping" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "This workbook uses the displayed units and formats." }));
    fireEvent.click(confirm);
    await screen.findByText(/This workbook is confirmed/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toEqual({ action: "CONFIRM", fingerprint: "a".repeat(64) });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("an administrator must reconfirm all fields before saving an edited mapping", async () => {
    const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async () => reply({ ...ready(), canSave: true })); vi.stubGlobal("fetch", fetcher);
    render(<MappingSetupClient uploadId="upload" />); fireEvent.click(await screen.findByRole("button", { name: "Change saved mapping" }));
    const save = screen.getByRole("button", { name: "Save and activate reviewed mapping" }); expect(save).toBeDisabled();
    const fieldConfirmations = screen.getAllByRole("checkbox"); expect(fieldConfirmations).toHaveLength(21);
    fieldConfirmations.forEach(box => fireEvent.click(box)); expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Unit for Total Weight"), { target: { value: "kg" } }); expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm the meaning and unit for Total Weight" }));
    fireEvent.click(save); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
    expect(body.action).toBe("SAVE"); expect(body.review.fields.every((f: { confirmed: boolean }) => f.confirmed)).toBe(true);
    expect(body.review.fields[11].unit).toBe("kg"); expect(Object.keys(body).sort()).toEqual(["action", "fingerprint", "review"]);
  });
  it("clears approval controls after live role loss and never automatically replays a write", async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => options.method === "POST" ? reply({ code: "FORBIDDEN" }, 403) : reply(ready()));
    vi.stubGlobal("fetch", fetcher); render(<MappingSetupClient uploadId="upload" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "This workbook uses the displayed units and formats." }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm mapping for this workbook" }));
    await screen.findByRole("alert"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("requires refresh after an uncertain write and accepts reconciliation without repeating it", async () => {
    let wrote = false;
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === "POST") { wrote = true; throw new Error("private provider diagnostic"); }
      return reply({ ...ready(), confirmed: wrote });
    });
    vi.stubGlobal("fetch", fetcher); render(<MappingSetupClient uploadId="upload" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "This workbook uses the displayed units and formats." }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm mapping for this workbook" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh before trying again");
    expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh mapping status" }));
    await screen.findByText(/This workbook is confirmed/);
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("does not present editing or confirmation for an attempt already pinned to history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ...ready(), kind: "PINNED" })));
    render(<MappingSetupClient uploadId="upload" />); await screen.findByText(/original mapping is kept/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("has no automated accessibility violations with approved choices displayed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(ready())));
    const { container } = render(<MappingSetupClient uploadId="upload" />); await screen.findByText(/Mapping version 2/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
