import { describe, expect, it } from "vitest";
import { WorksheetRunRegistry } from "../src/run-state.js";

describe("WorksheetRunRegistry", () => {
  it("tracks independent worksheet runs and terminal durations", () => {
    let now = 100;
    const runs = new WorksheetRunRegistry(() => now);

    expect(runs.getState("one")).toEqual({ status: "idle" });
    expect(runs.begin("one")).toBeDefined();
    expect(runs.begin("two")).toBeDefined();
    expect(runs.getState("one")).toEqual({ status: "preparing", startedAt: 100 });

    runs.transition("one", "resolving");
    expect(runs.getState("one").status).toBe("resolving");
    expect(runs.getState("two").status).toBe("preparing");

    now = 175;
    runs.finish("one", "succeeded");
    expect(runs.getState("one")).toEqual({
      status: "succeeded",
      startedAt: 100,
      durationMs: 75,
    });
    expect(runs.isRunning("one")).toBe(false);
    expect(runs.isRunning("two")).toBe(true);
  });

  it("rejects a repeated run and cancels the active run", () => {
    const runs = new WorksheetRunRegistry();
    const run = runs.begin("worksheet");

    expect(run).toBeDefined();
    expect(runs.begin("worksheet")).toBeUndefined();
    expect(run?.cancellationSignal.aborted).toBe(false);
    expect(runs.cancel("worksheet")).toBe(true);
    expect(run?.cancellationSignal.aborted).toBe(true);

    runs.finish("worksheet", "cancelled");
    expect(runs.getState("worksheet").status).toBe("cancelled");
    expect(runs.begin("worksheet")).toBeDefined();
  });

  it("aborts all active runs when disposed", () => {
    const runs = new WorksheetRunRegistry();
    const first = runs.begin("first");
    const second = runs.begin("second");

    runs.dispose();

    expect(first?.cancellationSignal.aborted).toBe(true);
    expect(second?.cancellationSignal.aborted).toBe(true);
    expect(runs.getState("first")).toEqual({ status: "idle" });
    expect(runs.isRunning("second")).toBe(false);
  });

  it("publishes state changes and preserves the resolved execution mode", () => {
    const runs = new WorksheetRunRegistry();
    const changes: string[] = [];
    const dispose = runs.onDidChange((uri, state) => changes.push(`${uri}:${state.status}`));

    runs.begin("worksheet");
    runs.setExecutionMode("worksheet", "gradleClasspath");
    runs.transition("worksheet", "running");
    runs.finish("worksheet", "succeeded");
    dispose();

    expect(changes).toEqual([
      "worksheet:preparing",
      "worksheet:preparing",
      "worksheet:running",
      "worksheet:succeeded",
    ]);
    expect(runs.getState("worksheet").executionMode).toBe("gradleClasspath");
  });
});
