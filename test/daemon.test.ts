import { describe, expect, it, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findKotlinHomeFromPath,
  KotlinDaemonClient,
  shutdownSharedKotlinDaemon,
} from "../src/daemon.js";

describe("Kotlin Daemon Client", () => {
  afterAll(async () => {
    await shutdownSharedKotlinDaemon();
  });

  it("resolves Kotlin home from PATH", () => {
    const home = findKotlinHomeFromPath("kotlinc");
    expect(home).toBeDefined();
    expect(typeof home).toBe("string");
  });

  it("returns undefined for non-existent kotlin command", () => {
    const home = findKotlinHomeFromPath("__non_existent_command__");
    expect(home).toBeUndefined();
  });

  it("locates daemon JAR and detects availability", () => {
    const client = new KotlinDaemonClient();
    const jarPath = client.getDaemonJarPath();
    expect(jarPath).toBeDefined();
    expect(client.isAvailable("kotlinc")).toBe(true);
  });

  it("starts, executes scripts, and shuts down", async () => {
    const client = new KotlinDaemonClient();
    const tempDir = await mkdtemp(path.join(tmpdir(), "daemon-unit-test-"));
    const scriptFile = path.join(tempDir, "sample.main.kts");

    try {
      await writeFile(scriptFile, 'val x = 15; println("calc: " + (x * 3))\n', "utf8");

      // First run (daemon starts up)
      const res1 = await client.executeScript({
        scriptPath: scriptFile,
        timeoutMs: 25000,
      });

      expect(res1.exitCode).toBe(0);
      expect(res1.stdout).toContain("calc: 45");
      expect(client.isRunning).toBe(true);

      // Second run (warm evaluation)
      const res2 = await client.executeScript({
        scriptPath: scriptFile,
        timeoutMs: 15000,
      });

      expect(res2.exitCode).toBe(0);
      expect(res2.stdout).toContain("calc: 45");

      // Verify warm evaluation is fast
      if (res2.durationMs !== undefined) {
        expect(res2.durationMs).toBeLessThan(1500);
      }
    } finally {
      await client.shutdown();
      expect(client.isRunning).toBe(false);
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 40000);

  it("handles script compilation errors", async () => {
    const client = new KotlinDaemonClient();
    const tempDir = await mkdtemp(path.join(tmpdir(), "daemon-unit-err-"));
    const scriptFile = path.join(tempDir, "error.main.kts");

    try {
      await writeFile(scriptFile, 'val num: Int = "not_int"\n', "utf8");
      const res = await client.executeScript({
        scriptPath: scriptFile,
        timeoutMs: 25000,
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("error:");
    } finally {
      await client.shutdown();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 40000);

  it("handles cancellation", async () => {
    const client = new KotlinDaemonClient();
    const tempDir = await mkdtemp(path.join(tmpdir(), "daemon-unit-cancel-"));
    const scriptFile = path.join(tempDir, "cancel.main.kts");

    try {
      await writeFile(scriptFile, 'Thread.sleep(10000); println("done")\n', "utf8");
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 200);

      const res = await client.executeScript({
        scriptPath: scriptFile,
        timeoutMs: 15000,
        cancellationSignal: controller.signal,
      });

      expect(res.cancelled).toBe(true);
    } finally {
      await client.shutdown();
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30000);
});
