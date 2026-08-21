import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GradleClasspathCache, fingerprintGradleProject } from "../src/gradle-cache.js";
import type { GradleClasspathResult } from "../src/gradle.js";

describe("GradleClasspathCache", () => {
  it("returns a cached classpath when the fingerprint is unchanged", async () => {
    let calls = 0;
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return successfulClasspath([`/classpath/${calls}`]);
      },
    });

    const first = await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/src" });
    const second = await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/src" });

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.classpath).toEqual(["/classpath/1"]);
    expect(calls).toBe(1);
  });

  it("bypasses a populated cache when disabled", async () => {
    let calls = 0;
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return successfulClasspath([`/classpath/${calls}`]);
      },
    });

    await cache.resolve("/project", { timeoutMs: 1000 });
    const disabled = await cache.resolve("/project", { timeoutMs: 1000, enabled: false });

    expect(disabled.cacheStatus).toBe("disabled");
    expect(disabled.classpath).toEqual(["/classpath/2"]);
    expect(calls).toBe(2);
  });

  it("invalidates cached classpaths when the fingerprint changes", async () => {
    let calls = 0;
    let fingerprint = "one";
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => fingerprint,
      resolveClasspath: async () => {
        calls += 1;
        return successfulClasspath([`/classpath/${calls}`]);
      },
    });

    await cache.resolve("/project", { timeoutMs: 1000 });
    fingerprint = "two";
    const second = await cache.resolve("/project", { timeoutMs: 1000 });

    expect(second.cacheStatus).toBe("invalidated");
    expect(second.classpath).toEqual(["/classpath/2"]);
    expect(calls).toBe(2);
  });

  it("does not cache failed resolutions", async () => {
    let calls = 0;
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return calls === 1 ? failedClasspath() : successfulClasspath(["/classpath"]);
      },
    });

    const first = await cache.resolve("/project", { timeoutMs: 1000 });
    const second = await cache.resolve("/project", { timeoutMs: 1000 });

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(second.cacheStatus).toBe("miss");
    expect(calls).toBe(2);
  });

  it("shares in-flight classpath resolutions", async () => {
    let calls = 0;
    let resolveRequest: ((result: GradleClasspathResult) => void) | undefined;
    const resolverReady = new Promise<void>((resolve) => {
      resolveRequest = (result) => {
        resolve();
        pendingResolve(result);
      };
    });
    let pendingResolve: (result: GradleClasspathResult) => void = () => {};
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return await new Promise<GradleClasspathResult>((resolve) => {
          pendingResolve = resolve;
        });
      },
    });

    const first = cache.resolve("/project", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    const second = cache.resolve("/project", { timeoutMs: 1000 });
    resolveRequest?.(successfulClasspath(["/classpath"]));
    await resolverReady;

    expect((await first).cacheStatus).toBe("miss");
    expect((await second).cacheStatus).toBe("shared");
    expect(calls).toBe(1);
  });

  it("does not repopulate the cache from a request started before refresh", async () => {
    let calls = 0;
    const resolvers: Array<(result: GradleClasspathResult) => void> = [];
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return await new Promise<GradleClasspathResult>((resolve) => resolvers.push(resolve));
      },
    });

    const first = cache.resolve("/project", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.clear("/project")).toBe(0);

    const second = cache.resolve("/project", { timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);

    resolvers[0](successfulClasspath(["/stale"]));
    resolvers[1](successfulClasspath(["/fresh"]));

    expect((await first).classpath).toEqual(["/stale"]);
    expect((await second).classpath).toEqual(["/fresh"]);
    const third = await cache.resolve("/project", { timeoutMs: 1000 });
    expect(third.cacheStatus).toBe("hit");
    expect(third.classpath).toEqual(["/fresh"]);
  });

  it("keeps a fresh fingerprint result cached when it resolves before a stale request", async () => {
    let fingerprintCalls = 0;
    const resolvers: Array<(result: GradleClasspathResult) => void> = [];
    let firstFingerprintStarted: (() => void) | undefined;
    const firstFingerprintReady = new Promise<void>((resolve) => {
      firstFingerprintStarted = resolve;
    });
    let releaseFirstFingerprint: (() => void) | undefined;
    const firstFingerprintRelease = new Promise<void>((resolve) => {
      releaseFirstFingerprint = resolve;
    });
    let secondRequestStarted: (() => void) | undefined;
    const secondRequestReady = new Promise<void>((resolve) => {
      secondRequestStarted = resolve;
    });
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => {
        if (fingerprintCalls++ === 0) {
          firstFingerprintStarted?.();
          await firstFingerprintRelease;
          return "stale";
        }
        return "fresh";
      },
      resolveClasspath: async () => await new Promise<GradleClasspathResult>((resolve) => {
        resolvers.push(resolve);
        if (resolvers.length === 2) {
          secondRequestStarted?.();
        }
        if (resolvers.length === 3) {
          resolve(successfulClasspath(["/unexpected"]));
        }
      }),
    });

    const stale = cache.resolve("/project", { timeoutMs: 1000 });
    await firstFingerprintReady;
    releaseFirstFingerprint?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const fresh = cache.resolve("/project", { timeoutMs: 1000 });
    await secondRequestReady;

    resolvers[1](successfulClasspath(["/fresh"]));
    resolvers[0](successfulClasspath(["/stale"]));

    expect((await fresh).classpath).toEqual(["/fresh"]);
    expect((await stale).classpath).toEqual(["/stale"]);
    const cached = await cache.resolve("/project", { timeoutMs: 1000 });
    expect(cached.cacheStatus).toBe("hit");
    expect(cached.classpath).toEqual(["/fresh"]);
  });

  it("does not populate the cache when refresh happens during fingerprinting", async () => {
    let releaseFingerprint: (() => void) | undefined;
    const fingerprintReady = new Promise<void>((resolve) => {
      releaseFingerprint = resolve;
    });
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => {
        await fingerprintReady;
        return "same";
      },
      resolveClasspath: async () => successfulClasspath(["/stale"]),
    });

    const beforeRefresh = cache.resolve("/project", { timeoutMs: 1000 });
    await Promise.resolve();
    expect(cache.clear("/project")).toBe(0);
    releaseFingerprint?.();

    expect((await beforeRefresh).classpath).toEqual(["/stale"]);
    const afterRefresh = await cache.resolve("/project", { timeoutMs: 1000 });
    expect(afterRefresh.cacheStatus).toBe("miss");
  });

  it("uses worksheet directories as separate cache keys", async () => {
    let calls = 0;
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return successfulClasspath([`/classpath/${calls}`]);
      },
    });

    const app = await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/app" });
    const lib = await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/lib" });

    expect(app.classpath).toEqual(["/classpath/1"]);
    expect(lib.classpath).toEqual(["/classpath/2"]);
    expect(calls).toBe(2);
  });

  it("clears cached entries", async () => {
    let calls = 0;
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => {
        calls += 1;
        return successfulClasspath([`/classpath/${calls}`]);
      },
    });

    await cache.resolve("/project", { timeoutMs: 1000 });
    expect(cache.clear("/project")).toBe(1);
    const second = await cache.resolve("/project", { timeoutMs: 1000 });

    expect(second.cacheStatus).toBe("miss");
    expect(calls).toBe(2);
  });

  it("clears all worksheet entries for a project root", async () => {
    const cache = new GradleClasspathCache({
      detectCommand: async () => ({ command: "gradle", args: [] }),
      fingerprint: async () => "same",
      resolveClasspath: async () => successfulClasspath(["/classpath"]),
    });

    await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/app" });
    await cache.resolve("/project", { timeoutMs: 1000, worksheetDir: "/project/lib" });

    expect(cache.clear("/project")).toBe(2);
  });
});

describe("fingerprintGradleProject", () => {
  it("changes when build or source files change", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gradle-cache-"));
    try {
      await mkdir(path.join(root, "src", "main", "kotlin"), { recursive: true });
      const buildFile = path.join(root, "build.gradle.kts");
      const sourceFile = path.join(root, "src", "main", "kotlin", "App.kt");
      await writeFile(buildFile, "plugins {}", "utf8");
      await writeFile(sourceFile, "fun one() = 1", "utf8");

      const first = await fingerprintGradleProject(root);
      await writeFile(sourceFile, "fun two() = 222", "utf8");
      const second = await fingerprintGradleProject(root);
      await writeFile(buildFile, "plugins { kotlin(\"jvm\") }", "utf8");
      const third = await fingerprintGradleProject(root);

      expect(second).not.toBe(first);
      expect(third).not.toBe(second);

      await mkdir(path.join(root, "gradle"), { recursive: true });
      const catalogFile = path.join(root, "gradle", "libs.versions.toml");
      await writeFile(catalogFile, "[versions]\nnarrow = \"2.2.3\"\n", "utf8");
      const withCatalog = await fingerprintGradleProject(root);
      await writeFile(catalogFile, "[versions]\nnarrow = \"2.2.4\"\n", "utf8");
      const afterCatalogChange = await fingerprintGradleProject(root);
      expect(afterCatalogChange).not.toBe(withCatalog);

      const subproject = path.join(root, "app");
      const subprojectBuildFile = path.join(subproject, "build.gradle.kts");
      const subprojectSourceFile = path.join(subproject, "src", "main", "kotlin", "App.kt");
      const worksheetDir = path.join(subproject, "src");
      await mkdir(path.dirname(subprojectSourceFile), { recursive: true });
      await writeFile(subprojectBuildFile, "plugins {}", "utf8");
      await writeFile(subprojectSourceFile, "fun app() = 1", "utf8");

      const subprojectFirst = await fingerprintGradleProject(root, worksheetDir);
      await writeFile(subprojectBuildFile, "plugins { kotlin(\"jvm\") }", "utf8");
      const subprojectAfterBuildChange = await fingerprintGradleProject(root, worksheetDir);
      await writeFile(subprojectSourceFile, "fun app() = 2", "utf8");
      const subprojectAfterSourceChange = await fingerprintGradleProject(root, worksheetDir);

      expect(subprojectAfterBuildChange).not.toBe(subprojectFirst);
      expect(subprojectAfterSourceChange).not.toBe(subprojectAfterBuildChange);

      const sibling = path.join(root, "lib");
      const siblingBuildFile = path.join(sibling, "build.gradle.kts");
      const siblingSourceFile = path.join(sibling, "src", "main", "kotlin", "Lib.kt");
      await mkdir(path.dirname(siblingSourceFile), { recursive: true });
      await writeFile(siblingBuildFile, "plugins {}", "utf8");
      await writeFile(siblingSourceFile, "fun lib() = 1", "utf8");

      const withSibling = await fingerprintGradleProject(root, worksheetDir);
      await writeFile(siblingBuildFile, "plugins { kotlin(\"jvm\") }", "utf8");
      const afterSiblingBuildChange = await fingerprintGradleProject(root, worksheetDir);
      await writeFile(siblingSourceFile, "fun lib() = 2", "utf8");
      const afterSiblingSourceChange = await fingerprintGradleProject(root, worksheetDir);

      expect(afterSiblingBuildChange).not.toBe(withSibling);
      expect(afterSiblingSourceChange).not.toBe(afterSiblingBuildChange);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function successfulClasspath(classpath: string[]): GradleClasspathResult {
  return {
    success: true,
    classpath,
    stdout: classpath.join(path.delimiter),
    stderr: "",
    exitCode: 0,
    timedOut: false,
    cancelled: false,
  };
}

function failedClasspath(): GradleClasspathResult {
  return {
    success: false,
    classpath: [],
    stdout: "",
    stderr: "failed",
    exitCode: 1,
    timedOut: false,
    cancelled: false,
  };
}
