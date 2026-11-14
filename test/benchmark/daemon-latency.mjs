/* global console, performance, process */

import { cpus, platform, arch, totalmem } from "node:os";
import { execSync } from "node:child_process";
import { executeWorksheet } from "../../out/executor.js";
import { shutdownSharedKotlinDaemon } from "../../out/daemon.js";

function getToolVersion(cmd, args) {
  try {
    return execSync(`${cmd} ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const workloads = [
  {
    name: "Simple Arithmetic",
    code: ["val a = 40", "val b = 2", "a + b"].join("\n"),
  },
  {
    name: "Collections Pipeline",
    code: ["val nums = (1..100).filter { it % 2 == 0 }.map { it * 2 }", "nums.sum()"].join("\n"),
  },
  {
    name: "Multiline Loop",
    code: ["var sum = 0", "for (i in 1..50) {", "  sum += i", "}", "sum"].join("\n"),
  },
  {
    name: "Function Definition & Call",
    code: ["fun square(n: Int): Int = n * n", "square(12)"].join("\n"),
  },
];

async function measure(fn) {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  return {
    durationMs: end - start,
    result,
  };
}

function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

async function runBenchmark() {
  const kotlinVersion = getToolVersion("kotlinc", "-version");
  const javaVersion = getToolVersion("java", "-version 2>&1");
  const firstJavaLine = javaVersion.split("\n")[0] || "unknown";
  const cpuModel = cpus()[0]?.model || "unknown";
  const ramGb = (totalmem() / 1024 / 1024 / 1024).toFixed(1);

  console.log("================================================================================");
  console.log(" Kotlin Worksheet - Daemon Latency Benchmark (v1.0.0)");
  console.log("================================================================================");
  console.log(` Machine : ${cpuModel} (${platform()} ${arch()}, ${ramGb} GB RAM)`);
  console.log(` Kotlin  : ${kotlinVersion}`);
  console.log(` Java    : ${firstJavaLine}`);
  console.log("================================================================================\n");

  // Ensure clean daemon state
  await shutdownSharedKotlinDaemon();

  console.log("Phase 1: Measuring Cold kotlinc Process Execution...");
  const coldResults = [];
  for (const wl of workloads) {
    const { durationMs, result } = await measure(() =>
      executeWorksheet(wl.code, {
        kotlinCommand: "kotlinc",
        timeoutMs: 30000,
        useDaemon: false,
      }),
    );
    if (!result.success) {
      console.error(`Cold run failed for ${wl.name}:`, result.stderr);
      throw new Error(`Cold run failed for ${wl.name}: ${result.stderr}`);
    }
    coldResults.push({
      workload: wl.name,
      coldDurationMs: durationMs,
      success: result.success,
    });
  }

  console.log("Phase 2: Bootstrapping & Warming Persistent JVM Daemon...");
  // Bootstrap daemon with first run
  const bootstrap = await measure(() =>
    executeWorksheet(workloads[0].code, {
      kotlinCommand: "kotlinc",
      timeoutMs: 30000,
      useDaemon: true,
    }),
  );
  if (!bootstrap.result.success) {
    console.error("Daemon bootstrap failed:", bootstrap.result.stderr);
    throw new Error(`Daemon bootstrap failed: ${bootstrap.result.stderr}`);
  }
  console.log(`Daemon bootstrap (cold JVM startup + compilation): ${bootstrap.durationMs.toFixed(1)} ms\n`);

  console.log("Phase 3: Measuring Warm Daemon Latency (10 iterations per workload)...");
  const warmTable = [];
  const WARM_ITERATIONS = 10;

  for (const wl of workloads) {
    const sampleDurations = [];
    for (let i = 0; i < WARM_ITERATIONS; i += 1) {
      const { durationMs, result } = await measure(() =>
        executeWorksheet(wl.code, {
          kotlinCommand: "kotlinc",
          timeoutMs: 15000,
          useDaemon: true,
        }),
      );
      if (!result.success) {
        console.error(`Warm run failed for ${wl.name} on iter ${i}:`, result.stderr);
        throw new Error(`Warm run failed for ${wl.name} on iter ${i}: ${result.stderr}`);
      }
      sampleDurations.push(durationMs);
    }

    const min = Math.min(...sampleDurations);
    const max = Math.max(...sampleDurations);
    const mean = sampleDurations.reduce((a, b) => a + b, 0) / sampleDurations.length;
    const median = quantile(sampleDurations, 0.5);
    const p95 = quantile(sampleDurations, 0.95);
    const cold = coldResults.find((c) => c.workload === wl.name)?.coldDurationMs || 0;
    const speedup = (cold / median).toFixed(1) + "x";

    warmTable.push({
      Workload: wl.name,
      "Cold (ms)": cold.toFixed(1),
      "Min (ms)": min.toFixed(1),
      "Median (ms)": median.toFixed(1),
      "Mean (ms)": mean.toFixed(1),
      "P95 (ms)": p95.toFixed(1),
      "Max (ms)": max.toFixed(1),
      Speedup: speedup,
    });
  }

  console.table(warmTable);

  console.log("\nSummary of Empirical Findings:");
  const overallMedian = quantile(
    warmTable.map((r) => parseFloat(r["Median (ms)"])),
    0.5,
  );
  const overallCold = quantile(
    warmTable.map((r) => parseFloat(r["Cold (ms)"])),
    0.5,
  );
  console.log(` • Cold kotlinc baseline: ~${overallCold.toFixed(0)} ms`);
  console.log(` • Warm daemon median  : ~${overallMedian.toFixed(1)} ms`);
  console.log(` • Overall speedup     : ~${(overallCold / overallMedian).toFixed(1)}x faster\n`);

  await shutdownSharedKotlinDaemon();
}

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
