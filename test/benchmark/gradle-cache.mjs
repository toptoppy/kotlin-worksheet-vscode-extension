/* global console, performance, process */

import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { GradleClasspathCache } from "../../out/gradle-cache.js";
import { executeWorksheet } from "../../out/executor.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(root, "test", "fixtures", "gradle-java");
const timeoutMs = 60000;

if (!commandExists("gradle", ["-v"]) || !commandExists("kotlinc", ["-version"])) {
  console.error("Benchmark requires gradle and kotlinc on PATH. Install Gradle or run this on the release CI runner.");
  process.exit(1);
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "kotlin-worksheet-gradle-cache-benchmark-"));
let projectRoot = path.join(tempRoot, "gradle-java");
let worksheetDir = projectRoot;

try {
  await cp(fixture, projectRoot, { recursive: true });
  await rm(path.join(projectRoot, ".gradle"), { recursive: true, force: true });
  await rm(path.join(projectRoot, "build"), { recursive: true, force: true });
  await rm(path.join(projectRoot, "bin"), { recursive: true, force: true });
  const catalogFile = path.join(projectRoot, "gradle", "libs.versions.toml");
  await mkdir(path.dirname(catalogFile), { recursive: true });
  await writeFile(catalogFile, '[versions]\nfixture = "1.0.0"\n', "utf8");
  projectRoot = await realpath(projectRoot);
  worksheetDir = projectRoot;
  const cache = new GradleClasspathCache();
  const rows = [];

  const first = await measure("first run", () => cache.resolve(projectRoot, { timeoutMs, worksheetDir }));
  rows.push(row("first run", first));

  const second = await measure("second unchanged run", () => cache.resolve(projectRoot, { timeoutMs, worksheetDir }));
  rows.push(row("second unchanged run", second));

  const disabled = await measure("cache disabled", () => cache.resolve(projectRoot, { timeoutMs, worksheetDir, enabled: false }));
  rows.push(row("cache disabled", disabled));

  await writeFile(
    path.join(projectRoot, "src", "main", "java", "demo", "Greeting.java"),
    [
      "package demo;",
      "public final class Greeting {",
      "  public static String message() { return \"hello after source change\"; }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const invalidated = await measure("after source change", () => cache.resolve(projectRoot, { timeoutMs, worksheetDir }));
  rows.push(row("after source change", invalidated));

  await measure("dependency configuration", () => cache.resolve(projectRoot, { timeoutMs, worksheetDir }));
  await writeFile(catalogFile, '[versions]\nfixture = "1.0.1"\n', "utf8");
  const dependencyConfigurationChange = await measure(
    "dependency configuration change",
    () => cache.resolve(projectRoot, { timeoutMs, worksheetDir }),
  );
  rows.push(row("dependency configuration change", dependencyConfigurationChange));

  const execution = await measure("worksheet execution", () => executeWorksheet([
    "import demo.Greeting",
    "Greeting.message()",
  ].join("\n"), {
    kotlinCommand: "kotlinc",
    timeoutMs: 20000,
    classpath: dependencyConfigurationChange.result.classpath,
  }));

  console.log("\nGradle classpath cache benchmark");
  console.table(rows);
  console.log(`Worksheet execution: ${execution.durationMs.toFixed(1)} ms, success=${execution.result.success}`);
  for (const measurement of [first, second, disabled, invalidated, dependencyConfigurationChange]) {
    if (!measurement.result.success) {
      console.error(`${measurement.label} failed: ${measurement.result.stderr.trim()}`);
    }
  }
  if (!execution.result.success) {
    console.error(`worksheet execution failed: ${execution.result.stderr.trim()}`);
  }

  if (
    !first.result.success ||
    !second.result.success ||
    !disabled.result.success ||
    !invalidated.result.success ||
    !dependencyConfigurationChange.result.success ||
    first.result.classpath.length === 0 ||
    second.result.classpath.length === 0 ||
    disabled.result.classpath.length === 0 ||
    invalidated.result.classpath.length === 0 ||
    dependencyConfigurationChange.result.classpath.length === 0 ||
    !execution.result.success ||
    execution.result.results.get(2) !== "hello after source change"
  ) {
    throw new Error("Gradle classpath cache benchmark failed: a resolution or worksheet execution was unsuccessful.");
  }
  if (
    first.result.cacheStatus !== "miss" ||
    second.result.cacheStatus !== "hit" ||
    disabled.result.cacheStatus !== "disabled" ||
    invalidated.result.cacheStatus !== "invalidated" ||
    dependencyConfigurationChange.result.cacheStatus !== "invalidated"
  ) {
    throw new Error(
      `Gradle classpath cache benchmark status mismatch: first=${first.result.cacheStatus}, ` +
      `second=${second.result.cacheStatus}, source=${invalidated.result.cacheStatus}, ` +
      `disabled=${disabled.result.cacheStatus}, ` +
      `dependencyConfiguration=${dependencyConfigurationChange.result.cacheStatus}`,
    );
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function measure(label, action) {
  const started = performance.now();
  const result = await action();
  return { label, durationMs: performance.now() - started, result };
}

function row(label, measurement) {
  return {
    scenario: label,
    cache: measurement.result.cacheStatus,
    success: measurement.result.success,
    classpathEntries: measurement.result.classpath.length,
    durationMs: Number(measurement.durationMs.toFixed(1)),
  };
}

function commandExists(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}
