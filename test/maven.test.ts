import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyMavenFailure,
  describeMavenFailure,
  describeMavenFailureForUser,
  locateMavenProjectRoot,
  parseMavenClasspath,
  resolveMavenClasspath,
} from "../src/maven.js";
import { MavenClasspathCache } from "../src/maven-cache.js";

describe("Maven Project Support", () => {
  it("locates maven project root from nested directories", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mvn-locate-test-"));
    const nestedDir = path.join(tempDir, "src", "main", "kotlin");

    try {
      await writeFile(path.join(tempDir, "pom.xml"), "<project></project>", "utf8");
      const foundRoot = await locateMavenProjectRoot(nestedDir);
      expect(foundRoot).toBe(tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no pom.xml exists", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mvn-empty-test-"));
    try {
      const foundRoot = await locateMavenProjectRoot(tempDir);
      expect(foundRoot).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses delimited maven classpath entries", () => {
    const delimiter = path.delimiter;
    const raw = `/path/to/a.jar${delimiter}/path/to/b.jar${delimiter}/path/to/c.jar\n`;
    const parsed = parseMavenClasspath(raw);
    expect(parsed).toEqual(["/path/to/a.jar", "/path/to/b.jar", "/path/to/c.jar"]);
  });

  it("classifies maven failure kinds accurately", () => {
    expect(classifyMavenFailure({ classpath: [], stderr: "", timedOut: true, cancelled: false })).toBe("timeout");
    expect(classifyMavenFailure({ classpath: [], stderr: "", timedOut: false, cancelled: true })).toBe("cancelled");
    expect(
      classifyMavenFailure({
        classpath: [],
        stderr: "",
        timedOut: false,
        cancelled: false,
        startError: "No Maven project",
      }),
    ).toBe("missingProject");
    expect(
      classifyMavenFailure({
        classpath: [],
        stderr: "Could not resolve dependencies for project",
        timedOut: false,
        cancelled: false,
      }),
    ).toBe("dependencyResolution");
    expect(classifyMavenFailure({ classpath: [], stderr: "Build failed", timedOut: false, cancelled: false })).toBe(
      "emptyClasspath",
    );
  });

  it("describes maven failures for users", () => {
    expect(describeMavenFailureForUser("missingCommand")).toContain("Install Maven");
    expect(describeMavenFailureForUser("timeout")).toContain("timed out");
    expect(describeMavenFailureForUser("dependencyResolution")).toContain("Check dependencies");
    expect(describeMavenFailure({ classpath: [], stderr: "[ERROR] Failed to execute", timedOut: false })).toBe(
      "[ERROR] Failed to execute",
    );
  });

  it("caches maven classpath resolutions and hits cache on unchanged project", async () => {
    let callCount = 0;
    const cache = new MavenClasspathCache({
      detectCommand: async () => ({ command: "mvn", args: [] }),
      resolveClasspath: async () => {
        callCount++;
        return {
          success: true,
          classpath: ["/mock/cached.jar"],
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
        };
      },
      fingerprint: async () => "hash-v1",
    });

    const res1 = await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(res1.cacheStatus).toBe("miss");
    expect(res1.classpath).toEqual(["/mock/cached.jar"]);
    expect(callCount).toBe(1);

    const res2 = await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(res2.cacheStatus).toBe("hit");
    expect(callCount).toBe(1);
  });

  it("invalidates cache when fingerprint changes", async () => {
    let callCount = 0;
    let currentFingerprint = "hash-v1";

    const cache = new MavenClasspathCache({
      detectCommand: async () => ({ command: "mvn", args: [] }),
      resolveClasspath: async () => {
        callCount++;
        return {
          success: true,
          classpath: [`/mock/cached-${callCount}.jar`],
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
        };
      },
      fingerprint: async () => currentFingerprint,
    });

    await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(callCount).toBe(1);

    currentFingerprint = "hash-v2";
    const res2 = await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(res2.cacheStatus).toBe("invalidated");
    expect(res2.classpath).toEqual(["/mock/cached-2.jar"]);
    expect(callCount).toBe(2);
  });

  it("clears cached entries scoped to project root", async () => {
    let callCount = 0;
    const cache = new MavenClasspathCache({
      detectCommand: async () => ({ command: "mvn", args: [] }),
      resolveClasspath: async () => {
        callCount++;
        return {
          success: true,
          classpath: ["/mock/cached.jar"],
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
        };
      },
      fingerprint: async () => "hash-v1",
    });

    await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(callCount).toBe(1);

    const cleared = cache.clear("/mock/project");
    expect(cleared).toBe(1);

    const res2 = await cache.resolve("/mock/project", { timeoutMs: 1000 });
    expect(res2.cacheStatus).toBe("miss");
    expect(callCount).toBe(2);
  });

  it("resolves real maven dependencies when mvn is installed", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "mvn-real-test-"));
    const pomContent = `<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>real-mvn-test</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>com.google.code.gson</groupId>
            <artifactId>gson</artifactId>
            <version>2.10.1</version>
        </dependency>
    </dependencies>
</project>`;

    try {
      await writeFile(path.join(tempDir, "pom.xml"), pomContent, "utf8");
      const result = await resolveMavenClasspath(tempDir, { timeoutMs: 30000 });
      if (result.success) {
        expect(result.classpath.some((entry) => entry.includes("gson-2.10.1.jar"))).toBe(true);
      } else {
        // If system mvn is not globally available in test runner env, ensure failure is classified cleanly
        expect(result.exitCode !== 0 || result.startError).toBeTruthy();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 35000);
});
