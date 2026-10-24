import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import RunsPilotReviewClient from "@/app/data-hub/sources/runs-review/RunsPilotReviewClient";
import { RUNS_REVIEW_FIELDS } from "@/lib/data-hub/schemaProfiles/runsPilotReview";

afterEach(() => vi.unstubAllGlobals());
function packet() {
  const href = screen.getByRole("link", { name: "Download draft field review" }).getAttribute("href")!;
  return JSON.parse(decodeURIComponent(href.slice(href.indexOf(",") + 1)));
}
describe("Runs field review draft", () => {
  it("shows 21 individually labelled fields with all suggestions unconfirmed and no data requests", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<RunsPilotReviewClient />);
    expect(screen.getAllByRole("group")).toHaveLength(21);
    expect(screen.getAllByRole("checkbox")).toHaveLength(21);
    expect(screen.getAllByRole("checkbox").every(c => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 21");
    expect(fetcher).not.toHaveBeenCalled();
    expect(packet()).toMatchObject({ activationAllowed: false, missingPolicy: null });
    expect(packet().fields).toHaveLength(21);
  });
  it("requires a unit before confirmation, records explicit confirmation and clears it after edits", () => {
    render(<RunsPilotReviewClient />);
    const confirm = screen.getByRole("checkbox", { name: "I confirm the meaning and unit for Ave Bin Weight" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Unit for Ave Bin Weight"), { target: { value: "kg" } });
    fireEvent.click(confirm); expect(confirm).toBeChecked(); expect(screen.getByRole("status")).toHaveTextContent("1 of 21");
    fireEvent.change(screen.getByLabelText("Unit for Ave Bin Weight"), { target: { value: "t" } });
    expect(confirm).not.toBeChecked(); expect(packet().fields[12]).toMatchObject({ unit: "t", confirmed: false });
  });
  it("requires a negative-value decision for counts and clears confirmation when a source representation changes", () => {
    render(<RunsPilotReviewClient />);
    const vehicles = screen.getByRole("checkbox", { name: "I confirm the meaning and unit for Vehicles" });
    fireEvent.click(vehicles); expect(vehicles).toBeChecked();
    fireEvent.change(screen.getByLabelText("How is Vehicles recorded?"), { target: { value: "WHOLE_NUMBER" } });
    expect(vehicles).not.toBeChecked(); expect(vehicles).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Are negative values valid for Vehicles?"), { target: { value: "FORBID" } });
    fireEvent.click(vehicles);
    expect(screen.getByText(/Rejecting negative counts needs/)).toBeInTheDocument();
  });
  it("exports a completed review while still identifying unsupported day/rate mappings and forbidding activation", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<RunsPilotReviewClient />);
    fireEvent.change(screen.getByLabelText("How does your report mark missing values?"), { target: { value: "NULL_ONLY" } });
    for (const spec of RUNS_REVIEW_FIELDS) {
      if ([12, 18, 19, 20].includes(spec.ordinal)) fireEvent.change(screen.getByLabelText(`Unit for ${spec.header}`), {
        target: { value: spec.ordinal === 12 ? "kg" : "km" } });
      if (spec.count) fireEvent.change(screen.getByLabelText(`Are negative values valid for ${spec.header}?`), { target: { value: "ALLOW" } });
      fireEvent.click(screen.getByRole("checkbox", { name: `I confirm the meaning and unit for ${spec.header}` }));
    }
    expect(screen.getByRole("status")).toHaveTextContent("21 of 21");
    expect(screen.getByText(/Day-based quantities need/)).toBeInTheDocument();
    expect(screen.getAllByText(/Per-hour quantities need/)).toHaveLength(2);
    const exported = packet(); expect(exported.activationAllowed).toBe(false);
    expect(exported.fields.every((f: { confirmed: boolean }) => f.confirmed)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /activate|prepare/i })).not.toBeInTheDocument();
  });
  it("has no automated accessibility violations", async () => {
    const { container } = render(<RunsPilotReviewClient />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
