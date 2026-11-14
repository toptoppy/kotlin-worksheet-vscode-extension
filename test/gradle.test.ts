import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { executeWorksheet } from "../src/executor.js";
import {
  classifyGradleFailure,
  buildGradleFailureReport,
  describeGradleFailure,
  describeGradleFailureForUser,
  detectExecutionMode,
  formatGradleFailureLog,
  locateGradleProjectRoot,
  parseGradleClasspath,
  resolveGradleClasspath,
} from "../src/gradle.js";

describe("gradle project detection", () => {
  it("finds the nearest Gradle project root", async () => {
    const root = await createTempDir("gradle-root-");
    try {
      const nested = path.join(root, "app", "src");
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(root, "build.gradle.kts"), "plugins { kotlin(\"jvm\") version \"2.4.0\" }", "utf8");

      await expect(locateGradleProjectRoot(nested)).resolves.toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to local mode when no Gradle markers exist", async () => {
    const root = await createTempDir("no-gradle-");
    try {
      await mkdir(path.join(root, "src"), { recursive: true });

      await expect(detectExecutionMode(path.join(root, "src"), "auto")).resolves.toBe("localKotlinc");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("selects Gradle mode when a project root is present", async () => {
    const root = await createTempDir("gradle-auto-");
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "settings.gradle.kts"), "rootProject.name = \"sample\"", "utf8");

      await expect(detectExecutionMode(path.join(root, "src"), "auto")).resolves.toBe("gradleClasspath");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("gradle classpath parsing", () => {
  it("splits and trims path-delimited entries", () => {
    const separator = path.delimiter;
    const output = [`/one`, ` /two `, "", `/three`].join(separator);

    expect(parseGradleClasspath(output)).toEqual(["/one", "/two", "/three"]);
  });
});

describe("gradle failure descriptions", () => {
  it("formats the structured Output diagnostic with kind and raw detail", () => {
    expect(formatGradleFailureLog("[worksheet]", "missingProject", "No Gradle project contains the worksheet directory."))
      .toBe("[worksheet] Gradle failure kind=missingProject; detail=No Gradle project contains the worksheet directory.");
  });

  it("keeps multiline raw Gradle detail after the concise display detail", () => {
    const rawDetail = [
      "Could not resolve all files for configuration ':runtimeClasspath'.",
      " > Could not find com.example:missing:1.0.",
      "   Searched in the following locations: ...",
    ].join("\n");

    const log = formatGradleFailureLog(
      "[worksheet]",
      "dependencyResolution",
      "Could not resolve all files for configuration ':runtimeClasspath'.",
      rawDetail,
    );

    expect(log).toContain("detail=Could not resolve all files for configuration ':runtimeClasspath'.");
    expect(log).toContain(rawDetail);
    expect(log).toContain("Could not find com.example:missing:1.0.");
  });

  it("prioritizes timeout and startup failures", () => {
    expect(describeGradleFailure({
      classpath: [],
      stderr: "ignored",
      timedOut: true,
      startError: "also ignored",
    })).toBe("resolution timed out");
    expect(describeGradleFailure({
      classpath: [],
      stderr: "ignored",
      timedOut: false,
      startError: "Gradle is unavailable",
    })).toBe("Gradle is unavailable");
  });

  it("uses the first stderr line or explains an empty classpath", () => {
    expect(describeGradleFailure({
      classpath: [],
      stderr: "Configuration failed\nMore details",
      timedOut: false,
    })).toBe("Configuration failed");
    expect(describeGradleFailure({
      classpath: [],
      stderr: "",
      timedOut: false,
    })).toBe("no classpath entries were resolved");
  });
});

describe("gradle failure classification", () => {
  it.each([
    ["timed out", { timedOut: true }, "timeout"],
    ["cancelled", { cancelled: true }, "cancelled"],
    ["missing command", { startError: "No Gradle wrapper or gradle command found." }, "missingCommand"],
    ["missing project", { stderr: "No Gradle project contains the worksheet directory." }, "missingProject"],
    ["unsupported layout", { stderr: "No sourceSets extension found on project ':app'." }, "unsupportedLayout"],
    ["missing main source set", { stderr: "No main source set found on project ':app'." }, "unsupportedLayout"],
    ["runtimeClasspath property", { stderr: "Could not get property 'runtimeClasspath' for source set 'main'." }, "unsupportedLayout"],
    ["runtimeClasspath method", { stderr: "Could not find method runtimeClasspath() for arguments [] on source set 'main'." }, "unsupportedLayout"],
    ["unknown runtimeClasspath property", { stderr: "Could not get unknown property 'runtimeClasspath' for source set 'main'." }, "unsupportedLayout"],
    ["dependency resolution", { stderr: "Could not resolve all files for configuration ':runtimeClasspath'." }, "dependencyResolution"],
    ["empty classpath", {}, "emptyClasspath"],
  ])("classifies %s", (_name, overrides, expected) => {
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "",
      timedOut: false,
      cancelled: false,
      ...overrides,
    })).toBe(expected);
  });

  it("keeps the first useful detail for an unknown Gradle failure", () => {
    expect(describeGradleFailure({
      classpath: [],
      stderr: "Configuration failed\nMore details",
      timedOut: false,
      cancelled: false,
    })).toBe("Configuration failed");
  });

  it("classifies an unknown failure with a non-empty classpath as generic", () => {
    expect(classifyGradleFailure({
      classpath: ["/path/to/runtime.jar"],
      stderr: "Unexpected Gradle failure",
      timedOut: false,
      cancelled: false,
    })).toBe("gradleFailure");
  });

  it("keeps dependency failures distinct from runtimeClasspath layout errors", () => {
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "Could not get resource from repository for configuration ':runtimeClasspath'.",
      timedOut: false,
      cancelled: false,
    })).toBe("dependencyResolution");
  });

  it.each([
    ["unrelated method failure", "Could not find method foo() for arguments [] on project ':app'."],
    ["unrelated property failure", "Could not get property 'foo' on project ':app'."],
  ])("does not classify %s as dependency resolution", (_name, stderr) => {
    expect(classifyGradleFailure({
      classpath: ["/path/to/runtime.jar"],
      stderr,
      timedOut: false,
      cancelled: false,
    })).toBe("gradleFailure");
  });

  it.each([
    ["unrelated method failure", "Could not find method foo() for arguments [] on project ':app'. The classpath is available."],
    ["unrelated property failure", "Could not get property 'foo' on project ':app'. The classpath is available."],
  ])("does not classify %s as dependency resolution when stderr mentions classpath", (_name, stderr) => {
    expect(classifyGradleFailure({
      classpath: ["/path/to/runtime.jar"],
      stderr,
      timedOut: false,
      cancelled: false,
    })).toBe("gradleFailure");
  });

  it.each([
    "Could not get resource from repository for configuration ':runtimeClasspath'.",
    "Could not find com.example:missing:1.0 for configuration ':runtimeClasspath'.",
    "Failed to resolve dependency com.example:missing:1.0 for configuration ':runtimeClasspath'.",
    "Unable to resolve artifact com.example:missing:1.0 from repository for ':runtimeClasspath'.",
  ])("classifies dependency/resource failures even when runtimeClasspath is present", (stderr) => {
    expect(classifyGradleFailure({
      classpath: [],
      stderr,
      timedOut: false,
      cancelled: false,
    })).toBe("dependencyResolution");
  });

  it("builds a classified report with recovery reason and raw detail", () => {
    const rawDetail = [
      "Failed to resolve dependency com.example:missing:1.0 for configuration ':runtimeClasspath'.",
      "Caused by: repository returned HTTP 404",
    ].join("\n");

    const report = buildGradleFailureReport("[worksheet]", {
      classpath: [],
      stderr: rawDetail,
      timedOut: false,
      cancelled: false,
    });

    expect(report.kind).toBe("dependencyResolution");
    expect(report.detail).toBe("Failed to resolve dependency com.example:missing:1.0 for configuration ':runtimeClasspath'.");
    expect(report.reason).toContain("dependencies, repositories, or network access");
    expect(report.logMessage).toContain(rawDetail);
  });

  it("builds a cancelled report for post-resolution cancellation logging", () => {
    const report = buildGradleFailureReport("[worksheet]", {
      classpath: ["/path/to/runtime.jar"],
      stderr: "",
      timedOut: false,
      cancelled: true,
    });

    expect(report.kind).toBe("cancelled");
    expect(report.logMessage).toContain("[worksheet] Gradle failure kind=cancelled");
  });

  it("prioritizes structured failure fields over stderr patterns", () => {
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "Could not resolve all files",
      timedOut: true,
      cancelled: true,
      startError: "Gradle is unavailable",
    })).toBe("timeout");
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "No sourceSets extension found",
      timedOut: false,
      cancelled: true,
      startError: "Gradle is unavailable",
    })).toBe("cancelled");
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "No main source set found",
      timedOut: false,
      cancelled: false,
      startError: "Gradle is unavailable",
    })).toBe("missingCommand");
  });

  it("formats actionable recovery copy for Gradle failure kinds", () => {
    expect(describeGradleFailureForUser("missingCommand")).toContain("Install Gradle or add a Gradle wrapper");
    expect(describeGradleFailureForUser("dependencyResolution")).toContain("dependencies, repositories, or network access");
    expect(describeGradleFailureForUser("unsupportedLayout")).toContain("sourceSets.main.runtimeClasspath");
    expect(describeGradleFailureForUser("gradleFailure", "Configuration failed\nMore details")).toContain("Configuration failed");
  });
});

describe.skipIf(!hasGradle() || !hasKotlinc())("gradle classpath execution", () => {
  it("runs a worksheet against compiled Gradle project classes", async () => {
    const fixtureRoot = path.resolve("test/fixtures/gradle-java");
    const classpath = await resolveGradleClasspath(fixtureRoot, { timeoutMs: 60000 });

    expect(classpath.success, classpath.stderr).toBe(true);
    expect(classpath.classpath.length).toBeGreaterThan(0);

    const result = await executeWorksheet(
      [
        "import demo.Greeting",
        "Greeting.message()",
      ].join("\n"),
      {
        kotlinCommand: "kotlinc",
        timeoutMs: 20000,
        classpath: classpath.classpath,
      },
    );

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([[2, "hello from gradle"]]));
  }, 90000);

  it("resolves the nearest Gradle subproject classpath", async () => {
    const fixtureRoot = path.resolve("test/fixtures/gradle-multi");
    const classpath = await resolveGradleClasspath(fixtureRoot, {
      timeoutMs: 60000,
      worksheetDir: path.join(fixtureRoot, "app", "src"),
    });

    expect(classpath.success, classpath.stderr).toBe(true);
    expect(classpath.classpath.length).toBeGreaterThan(0);

    const result = await executeWorksheet(
      [
        "import demo.SubprojectGreeting",
        "SubprojectGreeting.message()",
      ].join("\n"),
      {
        kotlinCommand: "kotlinc",
        timeoutMs: 20000,
        classpath: classpath.classpath,
      },
    );

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([[2, "hello from gradle subproject"]]));
  }, 90000);

  it("runs a worksheet against Arrow Core from Maven Central", async () => {
    const fixtureRoot = path.resolve("test/fixtures/gradle-arrow");
    const classpath = await resolveGradleClasspath(fixtureRoot, { timeoutMs: 120000 });

    expect(classpath.success, classpath.stderr).toBe(true);
    expect(classpath.classpath.length).toBeGreaterThan(0);

    const result = await executeWorksheet(
      [
        "import arrow.core.Either",
        "import arrow.core.Option",
        "import arrow.core.Some",
        "import arrow.core.getOrElse",
        "Either.Right(21).map { it * 2 }.fold({ -1 }) { it }",
        "Some(21).map { it * 2 }.getOrElse { 0 }",
      ].join("\n"),
      {
        kotlinCommand: "kotlinc",
        timeoutMs: 30000,
        classpath: classpath.classpath,
      },
    );

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([
      [5, "42"],
      [6, "42"],
    ]));
  }, 150000);
});

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function hasGradle(): boolean {
  const result = spawnSync("gradle", ["-v"], { stdio: "ignore" });
  return result.status === 0;
}

function hasKotlinc(): boolean {
  const result = spawnSync("kotlinc", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}
