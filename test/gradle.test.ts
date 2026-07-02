import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { executeWorksheet } from "../src/executor.js";
import {
  detectExecutionMode,
  locateGradleProjectRoot,
  parseGradleClasspath,
  resolveGradleClasspath,
} from "../src/gradle.js";

describe("gradle project detection", () => {
  it("finds the nearest Gradle project root", async () => {
    const root = await createTempDir("gradle-root-");
    const nested = path.join(root, "app", "src");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, "build.gradle.kts"), "plugins { kotlin(\"jvm\") version \"2.4.0\" }", "utf8");

    await expect(locateGradleProjectRoot(nested)).resolves.toBe(root);
  });

  it("falls back to local mode when no Gradle markers exist", async () => {
    const root = await createTempDir("no-gradle-");
    await mkdir(path.join(root, "src"), { recursive: true });

    await expect(detectExecutionMode(path.join(root, "src"), "auto")).resolves.toBe("localKotlinc");
  });

  it("selects Gradle mode when a project root is present", async () => {
    const root = await createTempDir("gradle-auto-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "settings.gradle.kts"), "rootProject.name = \"sample\"", "utf8");

    await expect(detectExecutionMode(path.join(root, "src"), "auto")).resolves.toBe("gradleClasspath");
  });
});

describe("gradle classpath parsing", () => {
  it("splits and trims path-delimited entries", () => {
    const separator = path.delimiter;
    const output = [`/one`, ` /two `, "", `/three`].join(separator);

    expect(parseGradleClasspath(output)).toEqual(["/one", "/two", "/three"]);
  });
});

describe.skipIf(!hasGradle())("gradle classpath execution", () => {
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
        kotlincCommand: "kotlinc",
        timeoutMs: 20000,
        classpath: classpath.classpath,
      },
    );

    expect(result.success, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(result.results).toEqual(new Map([[1, "hello from gradle"]]));
  }, 90000);
});

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function hasGradle(): boolean {
  const result = spawnSync("gradle", ["-v"], { stdio: "ignore" });
  return result.status === 0;
}
