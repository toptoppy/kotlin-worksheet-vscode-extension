import { describe, expect, it, vi } from "vitest";
import { checkEnvironment, type EnvironmentCheckDependencies } from "../src/environment.js";

function dependencies(
  overrides: Partial<EnvironmentCheckDependencies> = {},
): EnvironmentCheckDependencies {
  return {
    runCommand: vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "info: kotlinc-jvm 2.4.0",
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    }),
    locateGradleRoot: vi.fn().mockResolvedValue(undefined),
    detectGradle: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("checkEnvironment", () => {
  it("does not execute configured tools in an untrusted workspace", async () => {
    const deps = dependencies();
    const result = await checkEnvironment({
      trusted: false,
      kotlinCommand: "kotlinc",
      executionMode: "auto",
      documentDir: "/workspace",
    }, deps);

    expect(result.ready).toBe(false);
    expect(result.kotlin.status).toBe("notChecked");
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it("reports the Kotlin version for a local environment", async () => {
    const result = await checkEnvironment({
      trusted: true,
      kotlinCommand: "kotlinc",
      executionMode: "localKotlinc",
      documentDir: "/workspace",
    }, dependencies());

    expect(result.ready).toBe(true);
    expect(result.kotlin).toMatchObject({
      status: "available",
      version: "info: kotlinc-jvm 2.4.0",
    });
    expect(result.gradle.status).toBe("notNeeded");
  });

  it("reports an unavailable Kotlin command", async () => {
    const result = await checkEnvironment({
      trusted: true,
      kotlinCommand: "missing-kotlinc",
      executionMode: "localKotlinc",
    }, dependencies({
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "command not found",
        exitCode: null,
        timedOut: false,
        cancelled: false,
        startError: "spawn missing-kotlinc ENOENT",
      }),
    }));

    expect(result.ready).toBe(false);
    expect(result.kotlin).toMatchObject({
      status: "unavailable",
      error: "spawn missing-kotlinc ENOENT",
    });
  });

  it("requires Gradle when Gradle classpath mode is selected", async () => {
    const result = await checkEnvironment({
      trusted: true,
      kotlinCommand: "kotlinc",
      executionMode: "gradleClasspath",
      documentDir: "/workspace",
    }, dependencies({
      locateGradleRoot: vi.fn().mockResolvedValue("/workspace"),
    }));

    expect(result.ready).toBe(false);
    expect(result.gradle).toMatchObject({
      required: true,
      status: "unavailable",
      projectRoot: "/workspace",
    });
  });

  it("allows automatic mode to fall back when Gradle is unavailable", async () => {
    const result = await checkEnvironment({
      trusted: true,
      kotlinCommand: "kotlinc",
      executionMode: "auto",
      documentDir: "/workspace",
    }, dependencies({
      locateGradleRoot: vi.fn().mockResolvedValue("/workspace"),
    }));

    expect(result.ready).toBe(true);
    expect(result.gradle.status).toBe("unavailable");
  });
});
