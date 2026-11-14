import path from "node:path";
import { getSharedKotlinDaemonClient } from "./daemon.js";
import {
  detectGradleCommand,
  locateGradleProjectRoot,
  type ExecutionMode,
  type GradleCommand,
} from "./gradle.js";
import {
  detectMavenCommand,
  locateMavenProjectRoot,
  type MavenCommand,
} from "./maven.js";
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

export interface MavenEnvironmentResult {
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
  maven?: MavenEnvironmentResult;
  daemon?: {
    available: boolean;
    running: boolean;
  };
}

export interface EnvironmentCheckDependencies {
  runCommand: (options: {
    command: string;
    args: string[];
    timeoutMs: number;
  }) => Promise<CapturedCommandResult>;
  locateGradleRoot: (startDir: string) => Promise<string | undefined>;
  detectGradle: (projectRoot: string) => Promise<GradleCommand | undefined>;
  locateMavenRoot?: (startDir: string) => Promise<string | undefined>;
  detectMaven?: (projectRoot: string) => Promise<MavenCommand | undefined>;
}

const defaultDependencies: EnvironmentCheckDependencies = {
  runCommand: runCapturedCommand,
  locateGradleRoot: locateGradleProjectRoot,
  detectGradle: detectGradleCommand,
  locateMavenRoot: locateMavenProjectRoot,
  detectMaven: detectMavenCommand,
};

export async function checkEnvironment(
  options: EnvironmentCheckOptions,
  dependencies: EnvironmentCheckDependencies = defaultDependencies,
): Promise<EnvironmentCheckResult> {
  const gradleRequired = options.executionMode === "gradleClasspath";
  const mavenRequired = options.executionMode === "mavenClasspath";

  if (!options.trusted) {
    return {
      ready: false,
      trusted: false,
      executionMode: options.executionMode,
      kotlin: { status: "notChecked", command: options.kotlinCommand },
      gradle: { required: gradleRequired, status: "notNeeded" },
      maven: { required: mavenRequired, status: "notNeeded" },
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
    required: gradleRequired,
    projectRoot,
    status: projectRoot ? "unavailable" : "notNeeded",
  };

  if (projectRoot) {
    const gradleCommand = await dependencies.detectGradle(projectRoot);
    gradle = gradleCommand
      ? {
          required: gradleRequired,
          projectRoot,
          status: "available",
          command: [gradleCommand.command, ...gradleCommand.args].join(" "),
        }
      : {
          required: gradleRequired,
          projectRoot,
          status: "unavailable",
          error: "No Gradle wrapper or gradle command found.",
        };
  } else if (gradleRequired) {
    gradle = {
      required: true,
      status: "unavailable",
      error: "No Gradle project was found.",
    };
  }

  const locateMaven = dependencies.locateMavenRoot ?? locateMavenProjectRoot;
  const detectMaven = dependencies.detectMaven ?? detectMavenCommand;
  const mavenRoot = options.documentDir
    ? await locateMaven(path.resolve(options.documentDir))
    : undefined;
  let maven: MavenEnvironmentResult = {
    required: mavenRequired,
    projectRoot: mavenRoot,
    status: mavenRoot ? "unavailable" : "notNeeded",
  };

  if (mavenRoot) {
    const mavenCommand = await detectMaven(mavenRoot);
    maven = mavenCommand
      ? {
          required: mavenRequired,
          projectRoot: mavenRoot,
          status: "available",
          command: [mavenCommand.command, ...mavenCommand.args].join(" "),
        }
      : {
          required: mavenRequired,
          projectRoot: mavenRoot,
          status: "unavailable",
          error: "No Maven wrapper or mvn command found.",
        };
  } else if (mavenRequired) {
    maven = {
      required: true,
      status: "unavailable",
      error: "No Maven pom.xml project was found.",
    };
  }

  const daemonClient = getSharedKotlinDaemonClient();
  const daemon = {
    available: daemonClient.isAvailable(options.kotlinCommand),
    running: daemonClient.isRunning,
  };

  const projectReady = (!gradleRequired || gradle.status === "available")
    && (!mavenRequired || maven.status === "available");

  return {
    ready: kotlinAvailable && projectReady,
    trusted: true,
    executionMode: options.executionMode,
    kotlin,
    gradle,
    maven,
    daemon,
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
