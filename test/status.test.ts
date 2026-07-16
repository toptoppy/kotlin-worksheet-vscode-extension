import { describe, expect, it } from "vitest";
import { buildWorksheetStatus } from "../src/status.js";

describe("buildWorksheetStatus", () => {
  it("shows ready state and run-on-save behavior before a run", () => {
    const status = buildWorksheetStatus({
      state: { status: "idle" },
      runOnSave: true,
      requestedExecutionMode: "auto",
    });

    expect(status.text).toContain("Ready (Auto)");
    expect(status.tooltip).toContain("Execution mode: auto");
    expect(status.tooltip).toContain("Run on save: enabled");
    expect(status.command).toBe("kotlinWorksheet.toggleRunOnSave");
  });

  it("offers cancellation while a worksheet is running", () => {
    const status = buildWorksheetStatus({
      state: { status: "running", executionMode: "gradleClasspath" },
      runOnSave: false,
      requestedExecutionMode: "auto",
    });

    expect(status.text).toContain("Running");
    expect(status.tooltip).toContain("Execution mode: gradleClasspath");
    expect(status.tooltip).toContain("Click to cancel");
    expect(status.command).toBe("kotlinWorksheet.cancelActiveRun");
  });

  it.each([
    ["succeeded", "Passed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["timedOut", "Timed Out"],
  ] as const)("renders the %s terminal state", (runStatus, label) => {
    const status = buildWorksheetStatus({
      state: { status: runStatus, durationMs: 1250 },
      runOnSave: false,
      requestedExecutionMode: "localKotlinc",
    });

    expect(status.text).toContain(label);
    expect(status.tooltip).toContain("Last duration: 1.3 s");
    expect(status.command).toBe("kotlinWorksheet.toggleRunOnSave");
  });
});
