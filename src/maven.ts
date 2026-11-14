import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCapturedCommand } from "./process.js";

export interface MavenClasspathResult {
  success: boolean;
  classpath: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

export type MavenFailureKind =
  | "missingCommand"
  | "timeout"
  | "cancelled"
  | "missingProject"
  | "dependencyResolution"
  | "emptyClasspath"
  | "mavenFailure";

export interface MavenResolveOptions {
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
  worksheetDir?: string;
}

export interface MavenCommand {
  command: string;
  args: string[];
}

type MavenFailureInput = Pick<
  MavenClasspathResult,
  "classpath" | "stderr" | "timedOut" | "cancelled" | "startError"
>;

export interface MavenFailureReport {
  kind: MavenFailureKind;
  detail: string;
  reason: string;
  logMessage: string;
}

export function classifyMavenFailure(result: MavenFailureInput): MavenFailureKind {
  if (result.timedOut) {
    return "timeout";
  }
  if (result.cancelled) {
    return "cancelled";
  }
  if (result.startError) {
    return result.startError.includes("No Maven project") ? "missingProject" : "missingCommand";
  }

  const stderr = result.stderr;
  if (/Could not resolve dependencies|Failed to collect dependencies|ArtifactNotFoundException/i.test(stderr)) {
    return "dependencyResolution";
  }
  if (result.classpath.length === 0) {
    return "emptyClasspath";
  }
  return "mavenFailure";
}

export function describeMavenFailure(
  result: Pick<MavenClasspathResult, "classpath" | "stderr" | "timedOut" | "startError">,
): string {
  if (result.timedOut) {
    return "resolution timed out";
  }
  if (result.startError) {
    return result.startError;
  }

  const firstErrorLine = result.stderr.trim().split(/\r?\n/, 1)[0];
  if (firstErrorLine) {
    return firstErrorLine;
  }
  if (result.classpath.length === 0) {
    return "no classpath entries were resolved";
  }
  return "unknown error";
}

export function describeMavenFailureForUser(kind: MavenFailureKind, detail?: string): string {
  const descriptions: Record<MavenFailureKind, string> = {
    missingCommand: "Install Maven or add a Maven wrapper (mvnw) to the project.",
    timeout: "Maven resolution timed out. Increase kotlinWorksheet.timeoutMs or inspect Maven build performance.",
    cancelled: "Maven resolution was cancelled.",
    missingProject: "No Maven pom.xml contains the worksheet directory.",
    dependencyResolution: "Check dependencies, repositories, or network access in pom.xml.",
    emptyClasspath: "Maven resolved an empty classpath. Inspect the full log.",
    mavenFailure: "Maven resolution failed. Inspect the full log.",
  };

  if (kind !== "mavenFailure") {
    return descriptions[kind];
  }

  const firstDetailLine = detail?.trim().split(/\r?\n/, 1)[0];
  return firstDetailLine ? `${descriptions[kind]} Detail: ${firstDetailLine}` : descriptions[kind];
}

export function buildMavenFailureReport(logPrefix: string, result: MavenFailureInput): MavenFailureReport {
  const kind = classifyMavenFailure(result);
  const detail = describeMavenFailure(result);
  const reason = describeMavenFailureForUser(kind, detail);
  const rawDetail = result.stderr || result.startError;
  const conciseLog = `${logPrefix} Maven failure kind=${kind}; detail=${detail}`;
  const logMessage = rawDetail && rawDetail !== detail ? `${conciseLog}\n${logPrefix} Maven raw detail:\n${rawDetail}` : conciseLog;

  return {
    kind,
    detail,
    reason,
    logMessage,
  };
}

export async function locateMavenProjectRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  while (true) {
    try {
      await access(path.join(current, "pom.xml"), fsConstants.F_OK);
      return current;
    } catch {
      // search parent
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export async function detectMavenCommand(
  projectRoot: string,
  cancellationSignal?: AbortSignal,
): Promise<MavenCommand | undefined> {
  const wrapper = path.join(projectRoot, process.platform === "win32" ? "mvnw.cmd" : "mvnw");
  try {
    await access(wrapper, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return { command: wrapper, args: [] };
  } catch {
    // Wrapper not found, try system mvn
  }

  try {
    const testResult = await runCapturedCommand({
      command: "mvn",
      args: ["-v"],
      timeoutMs: 3000,
      cancellationSignal,
    });
    if (testResult.exitCode === 0) {
      return { command: "mvn", args: [] };
    }
  } catch {
    // mvn not available
  }

  return undefined;
}

export async function resolveMavenClasspath(
  projectRoot: string,
  options: MavenResolveOptions,
): Promise<MavenClasspathResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "kotlin-worksheet-maven-"));
  const outputFile = path.join(tempDir, "classpath.txt");

  try {
    const command = await detectMavenCommand(projectRoot, options.cancellationSignal);
    if (!command) {
      return {
        success: false,
        classpath: [],
        stdout: "",
        stderr: "No Maven wrapper or mvn command found.",
        exitCode: null,
        timedOut: false,
        cancelled: false,
        startError: "No Maven wrapper or mvn command found.",
      };
    }

    const result = await runCapturedCommand({
      command: command.command,
      args: [
        ...command.args,
        "dependency:build-classpath",
        `-Dmdep.outputFile=${outputFile}`,
        "-DincludeScope=test",
        "-q",
      ],
      cwd: projectRoot,
      timeoutMs: options.timeoutMs,
      cancellationSignal: options.cancellationSignal,
    });

    let resolvedClasspath: string[] = [];
    try {
      const content = await readFile(outputFile, "utf8");
      resolvedClasspath = parseMavenClasspath(content);
    } catch {
      // Output file was not written, meaning resolution failed
    }

    // Append project build target classes if they exist
    const targetClasses = path.join(projectRoot, "target", "classes");
    const targetTestClasses = path.join(projectRoot, "target", "test-classes");
    try {
      await access(targetClasses, fsConstants.F_OK);
      resolvedClasspath.unshift(targetClasses);
    } catch {
      // not built yet
    }
    try {
      await access(targetTestClasses, fsConstants.F_OK);
      resolvedClasspath.unshift(targetTestClasses);
    } catch {
      // not built yet
    }

    return {
      success: result.exitCode === 0 && !result.timedOut && !result.cancelled && resolvedClasspath.length > 0,
      classpath: resolvedClasspath,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      startError: result.startError,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function parseMavenClasspath(content: string): string[] {
  return content
    .split(path.delimiter)
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((entry) => entry.trim())
    .filter(Boolean);
}
