import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  detectExecutionMode,
  locateGradleProjectRoot,
  parseGradleClasspath,
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

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
