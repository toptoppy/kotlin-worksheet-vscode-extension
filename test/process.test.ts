import { describe, expect, it } from "vitest";
import { execPath } from "node:process";
import { runCapturedCommand } from "../src/process.js";

describe("runCapturedCommand", () => {
  it("reports timeout as the terminal reason", async () => {
    const result = await runCapturedCommand({
      command: execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      timeoutMs: 100,
      shell: false,
      detached: false,
    });

    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  }, 5000);

  it("reports cancellation as the terminal reason", async () => {
    const controller = new AbortController();
    const promise = runCapturedCommand({
      command: execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      timeoutMs: 5000,
      cancellationSignal: controller.signal,
      shell: false,
      detached: false,
    });

    setTimeout(() => controller.abort(), 100);
    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  }, 5000);

  it("captures large stdout and stderr output", async () => {
    const stdout = "out".repeat(10000);
    const stderr = "err".repeat(10000);
    const result = await runCapturedCommand({
      command: execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)});`],
      timeoutMs: 5000,
      shell: false,
      detached: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
  }, 5000);
});
