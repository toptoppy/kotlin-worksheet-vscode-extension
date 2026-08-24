import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runCapturedCommand } from "./process.js";

export type ExecutionMode = "auto" | "localKotlinc" | "gradleClasspath";

export interface GradleClasspathResult {
  success: boolean;
  classpath: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

export type GradleFailureKind =
  | "missingCommand"
  | "timeout"
  | "cancelled"
  | "missingProject"
  | "unsupportedLayout"
  | "dependencyResolution"
  | "emptyClasspath"
  | "gradleFailure";

export interface GradleResolveOptions {
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
  worksheetDir?: string;
}

export interface GradleCommand {
  command: string;
  args: string[];
}

type GradleFailureInput = Pick<
  GradleClasspathResult,
  "classpath" | "stderr" | "timedOut" | "cancelled" | "startError"
>;

export interface GradleFailureReport {
  kind: GradleFailureKind;
  detail: string;
  reason: string;
  logMessage: string;
}

export function classifyGradleFailure(
  result: GradleFailureInput,
): GradleFailureKind {
  if (result.timedOut) {
    return "timeout";
  }
  if (result.cancelled) {
    return "cancelled";
  }
  if (result.startError) {
    return result.startError.includes("No Gradle project") ? "missingProject" : "missingCommand";
  }

  const stderr = result.stderr;
  if (stderr.includes("No Gradle project contains")) {
    return "missingProject";
  }
  if (
    stderr.includes("No sourceSets extension") ||
    stderr.includes("No main source set") ||
    /Could not get (?:unknown )?property ['"]runtimeClasspath['"]/i.test(stderr) ||
    /Could not find method runtimeClasspath\s*\(/i.test(stderr) ||
    /(?:unknown property|no such property|does not exist|not found|missing)\W{0,40}runtimeClasspath/i.test(stderr) ||
    /runtimeClasspath\W{0,40}(?:unknown|does not exist|not found|missing)/i.test(stderr)
  ) {
    return "unsupportedLayout";
  }

  const hasDependencyContext = /\b(?:dependenc(?:y|ies)|resource|repository|repositories|module|artifact|configuration)\b/i.test(stderr);
  const hasModuleCoordinate = /\b[\w.-]+:[\w.-]+:[\w.+-]+\b/.test(stderr);
  const isDependencyFailure =
    /Could not resolve all files/i.test(stderr) ||
    /Could not get resource/i.test(stderr) ||
    /(?:Could not (?:find|resolve)|(?:Failed|Unable) to resolve)\b/i.test(stderr)
      && (hasDependencyContext || hasModuleCoordinate);
  if (isDependencyFailure) {
    return "dependencyResolution";
  }
  if (result.classpath.length === 0) {
    return "emptyClasspath";
  }
  return "gradleFailure";
}

export function describeGradleFailure(result: Pick<GradleClasspathResult, "classpath" | "stderr" | "timedOut" | "startError">): string {
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

export function formatGradleFailureLog(
  logPrefix: string,
  kind: GradleFailureKind,
  detail: string,
  rawDetail?: string,
): string {
  const conciseLog = `${logPrefix} Gradle failure kind=${kind}; detail=${detail}`;
  return rawDetail && rawDetail !== detail
    ? `${conciseLog}\n${logPrefix} Gradle raw detail:\n${rawDetail}`
    : conciseLog;
}

export function describeGradleFailureForUser(kind: GradleFailureKind, detail?: string): string {
  const descriptions: Record<GradleFailureKind, string> = {
    missingCommand: "Install Gradle or add a Gradle wrapper to the project.",
    timeout: "Gradle resolution timed out. Increase kotlinWorksheet.timeoutMs or inspect Gradle performance.",
    cancelled: "Gradle resolution was cancelled.",
    missingProject: "No Gradle project contains the worksheet directory.",
    unsupportedLayout: "Expose sourceSets.main.runtimeClasspath in the Gradle project or use local Kotlin.",
    dependencyResolution: "Check dependencies, repositories, or network access.",
    emptyClasspath: "Gradle resolved an empty classpath. Inspect the full Gradle Output log.",
    gradleFailure: "Gradle resolution failed. Inspect the full Gradle Output log.",
  };

  if (kind !== "gradleFailure") {
    return descriptions[kind];
  }

  const firstDetailLine = detail?.trim().split(/\r?\n/, 1)[0];
  return firstDetailLine ? `${descriptions[kind]} Detail: ${firstDetailLine}` : descriptions[kind];
}

export function buildGradleFailureReport(logPrefix: string, result: GradleFailureInput): GradleFailureReport {
  const kind = classifyGradleFailure(result);
  const detail = describeGradleFailure(result);
  const reason = describeGradleFailureForUser(kind, detail);
  const rawDetail = result.stderr || result.startError;
  return {
    kind,
    detail,
    reason,
    logMessage: formatGradleFailureLog(logPrefix, kind, detail, rawDetail),
  };
}

export async function locateGradleProjectRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  while (true) {
    if (await hasGradleMarkers(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

export async function resolveGradleClasspath(
  projectRoot: string,
  options: GradleResolveOptions,
): Promise<GradleClasspathResult> {
  const tempDir = await mkdirTemp("kotlin-worksheet-gradle-");
  const initScript = path.join(tempDir, "kotlin-worksheet.init.gradle");

  try {
    await writeFile(initScript, buildInitScript(), "utf8");
    const command = await detectGradleCommand(projectRoot, options.cancellationSignal);
    if (!command) {
      return {
        success: false,
        classpath: [],
        stdout: "",
        stderr: "No Gradle wrapper or gradle command found.",
        exitCode: null,
        timedOut: false,
        cancelled: false,
        startError: "No Gradle wrapper or gradle command found.",
      };
    }

    const result = await runCapturedCommand({
      command: command.command,
      args: [
        ...command.args,
        "--no-daemon",
        "--init-script",
        initScript,
        ...(options.worksheetDir ? [`-PkotlinWorksheetDir=${path.resolve(options.worksheetDir)}`] : []),
        "-q",
        "kotlinWorksheetPrintClasspath",
      ],
      cwd: projectRoot,
      timeoutMs: options.timeoutMs,
      cancellationSignal: options.cancellationSignal,
    });

    return {
      success: result.exitCode === 0 && !result.timedOut && !result.cancelled,
      classpath: parseGradleClasspath(result.stdout),
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

export function parseGradleClasspath(stdout: string): string[] {
  return stdout
    .replace(/\r\n/g, "\n")
    .trim()
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function detectExecutionMode(
  documentDir: string,
  requestedMode: ExecutionMode,
): Promise<"localKotlinc" | "gradleClasspath"> {
  if (requestedMode === "localKotlinc") {
    return "localKotlinc";
  }

  if (requestedMode === "gradleClasspath") {
    return "gradleClasspath";
  }

  const gradleRoot = await locateGradleProjectRoot(documentDir);
  return gradleRoot ? "gradleClasspath" : "localKotlinc";
}

async function hasGradleMarkers(dir: string): Promise<boolean> {
  const markers = [
    "settings.gradle",
    "settings.gradle.kts",
    "build.gradle",
    "build.gradle.kts",
    "gradlew",
    "gradlew.bat",
  ];

  for (const marker of markers) {
    try {
      await access(path.join(dir, marker), fsConstants.F_OK);
      return true;
    } catch {
      // keep searching
    }
  }

  return false;
}

export async function detectGradleCommand(projectRoot: string, cancellationSignal?: AbortSignal): Promise<GradleCommand | undefined> {
  const wrapper = path.join(projectRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  try {
    await access(wrapper, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return { command: wrapper, args: [] };
  } catch {
    return await commandExists("gradle", cancellationSignal) ? { command: "gradle", args: [] } : undefined;
  }
}

async function commandExists(command: string, cancellationSignal?: AbortSignal): Promise<boolean> {
  const test = await runCapturedCommand({
    command,
    args: ["-v"],
    timeoutMs: 10000,
    cancellationSignal,
  });
  return test.exitCode === 0;
}

async function mkdirTemp(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function buildInitScript(): string {
  return [
    "gradle.projectsEvaluated {",
    "  def root = gradle.rootProject",
    "  def requestedWorksheetDir = gradle.startParameter.projectProperties['kotlinWorksheetDir']",
    "  def worksheetDir = requestedWorksheetDir == null",
    "    ? root.projectDir.toPath().toAbsolutePath().normalize()",
    "    : new File(requestedWorksheetDir).toPath().toAbsolutePath().normalize()",
    "  def target = root.allprojects",
    "    .findAll { project ->",
    "      def projectDir = project.projectDir.toPath().toAbsolutePath().normalize()",
    "      worksheetDir == projectDir || worksheetDir.startsWith(projectDir)",
    "    }",
    "    .sort { left, right -> right.projectDir.path.length() <=> left.projectDir.path.length() }",
    "    .find { true }",
    "  root.tasks.register('kotlinWorksheetPrintClasspath') {",
    "    group = 'help'",
    "    description = 'Print worksheet classpath.'",
    "    if (target != null) {",
    "      def classesTask = target.tasks.findByName('classes')",
    "      if (classesTask != null) {",
    "        dependsOn(classesTask)",
    "      }",
    "    }",
    "    doLast {",
    "      if (target == null) {",
    "        throw new GradleException('No Gradle project contains the worksheet directory.')",
    "      }",
    "      def sourceSets = target.extensions.findByName('sourceSets')",
    "      if (sourceSets == null) {",
    "        throw new GradleException(\"No sourceSets extension found on project '${target.path}'.\")",
    "      }",
    "      def main = sourceSets.findByName('main')",
    "      if (main == null) {",
    "        throw new GradleException(\"No main source set found on project '${target.path}'.\")",
    "      }",
    "      println(main.runtimeClasspath.asPath)",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}
