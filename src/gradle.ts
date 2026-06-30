import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
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

export interface GradleResolveOptions {
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
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
    const command = await detectGradleCommand(projectRoot);
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
        "--init-script",
        initScript,
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

async function detectGradleCommand(projectRoot: string): Promise<{ command: string; args: string[] } | undefined> {
  const wrapper = path.join(projectRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  try {
    await access(wrapper, fsConstants.F_OK);
    return { command: wrapper, args: [] };
  } catch {
    return await commandExists("gradle") ? { command: "gradle", args: [] } : undefined;
  }
}

async function commandExists(command: string): Promise<boolean> {
  const test = await runCapturedCommand({
    command,
    args: ["-v"],
    timeoutMs: 10000,
  });
  return test.exitCode === 0;
}

async function mkdirTemp(prefix: string): Promise<string> {
  const dir = path.join(tmpdir(), prefix + Date.now().toString(36));
  await mkdir(dir, { recursive: true });
  return dir;
}

function buildInitScript(): string {
  return [
    "gradle.projectsEvaluated {",
    "  def root = gradle.rootProject",
    "  root.tasks.register('kotlinWorksheetPrintClasspath') {",
    "    group = 'help'",
    "    description = 'Print worksheet classpath.'",
    "    doLast {",
    "      def sourceSets = root.extensions.findByName('sourceSets')",
    "      if (sourceSets == null) {",
    "        throw new GradleException('No sourceSets extension found on root project.')",
    "      }",
    "      def main = sourceSets.findByName('main')",
    "      if (main == null) {",
    "        throw new GradleException('No main source set found.')",
    "      }",
    "      println(main.runtimeClasspath.asPath)",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}
