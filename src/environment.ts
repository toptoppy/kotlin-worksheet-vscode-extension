import path from "node:path";
import {
  detectGradleCommand,
  locateGradleProjectRoot,
  type ExecutionMode,
  type GradleCommand,
} from "./gradle.js";
import { runCapturedCommand, type CapturedCommandResult } from "./process.js";

export interface EnvironmentCheckOptions {
  trusted: boolean;
  kotlinCommand: string;
  executionMode: ExecutionMode;
  documentDir?: string;
  timeoutMs?: number;
}

export interface EnvironmentToolResult {
  status: "available" | "unavailable" | "notChecked";
  command: string;
  version?: string;
  error?: string;
}

export interface GradleEnvironmentResult {
  required: boolean;
  projectRoot?: string;
  status: "available" | "unavailable" | "notNeeded";
  command?: string;
  error?: string;
}

export interface EnvironmentCheckResult {
  ready: boolean;
  trusted: boolean;
  executionMode: ExecutionMode;
  kotlin: EnvironmentToolResult;
  gradle: GradleEnvironmentResult;
}

export interface EnvironmentCheckDependencies {
  runCommand: (options: {
    command: string;
    args: string[];
    timeoutMs: number;
  }) => Promise<CapturedCommandResult>;
  locateGradleRoot: (startDir: string) => Promise<string | undefined>;
  detectGradle: (projectRoot: string) => Promise<GradleCommand | undefined>;
}

const defaultDependencies: EnvironmentCheckDependencies = {
  runCommand: runCapturedCommand,
  locateGradleRoot: locateGradleProjectRoot,
  detectGradle: detectGradleCommand,
};

export async function checkEnvironment(
  options: EnvironmentCheckOptions,
  dependencies: EnvironmentCheckDependencies = defaultDependencies,
): Promise<EnvironmentCheckResult> {
  const required = options.executionMode === "gradleClasspath";
  if (!options.trusted) {
    return {
      ready: false,
      trusted: false,
      executionMode: options.executionMode,
      kotlin: { status: "notChecked", command: options.kotlinCommand },
      gradle: { required, status: "notNeeded" },
    };
  }

  const kotlinProcess = await dependencies.runCommand({
    command: options.kotlinCommand,
    args: ["-version"],
    timeoutMs: options.timeoutMs ?? 10000,
  });
  const kotlinAvailable = kotlinProcess.exitCode === 0
    && !kotlinProcess.timedOut
    && !kotlinProcess.cancelled
    && !kotlinProcess.startError;
  const kotlinOutput = `${kotlinProcess.stdout}\n${kotlinProcess.stderr}`.trim();
  const kotlin: EnvironmentToolResult = kotlinAvailable
    ? {
        status: "available",
        command: options.kotlinCommand,
        version: firstNonEmptyLine(kotlinOutput) ?? "version unavailable",
      }
    : {
        status: "unavailable",
        command: options.kotlinCommand,
        error: describeCommandFailure(kotlinProcess),
      };

  const projectRoot = options.documentDir
    ? await dependencies.locateGradleRoot(path.resolve(options.documentDir))
    : undefined;
  let gradle: GradleEnvironmentResult = {
    required,
    projectRoot,
    status: projectRoot ? "unavailable" : "notNeeded",
  };

  if (projectRoot) {
    const gradleCommand = await dependencies.detectGradle(projectRoot);
    gradle = gradleCommand
      ? {
          required,
          projectRoot,
          status: "available",
          command: [gradleCommand.command, ...gradleCommand.args].join(" "),
        }
      : {
          required,
          projectRoot,
          status: "unavailable",
          error: "No Gradle wrapper or gradle command found.",
        };
  } else if (required) {
    gradle = {
      required,
      status: "unavailable",
      error: "No Gradle project was found.",
    };
  }

  return {
    ready: kotlinAvailable && (!required || gradle.status === "available"),
    trusted: true,
    executionMode: options.executionMode,
    kotlin,
    gradle,
  };
}

function firstNonEmptyLine(output: string): string | undefined {
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function describeCommandFailure(result: CapturedCommandResult): string {
  if (result.timedOut) {
    return "Kotlin version check timed out.";
  }
  if (result.startError) {
    return result.startError;
  }
  return firstNonEmptyLine(result.stderr) ?? `Kotlin command exited with code ${result.exitCode ?? "unknown"}.`;
}
