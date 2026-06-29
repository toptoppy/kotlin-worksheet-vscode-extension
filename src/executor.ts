import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorksheetDiagnostic } from "./worksheet.js";
import { instrumentWorksheet, parseKotlinDiagnostics, parseWorksheetOutput } from "./worksheet.js";

export interface KotlinWorksheetExecution {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  results: Map<number, string>;
  diagnostics: WorksheetDiagnostic[];
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

export interface KotlinWorksheetExecutionOptions {
  kotlinCommand: string;
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
}

export async function executeWorksheet(
  source: string,
  options: KotlinWorksheetExecutionOptions,
): Promise<KotlinWorksheetExecution> {
  const instrumented = instrumentWorksheet(source);
  const tempDir = await mkdtemp(path.join(tmpdir(), "kotlin-worksheet-"));
  const tempFile = path.join(tempDir, "worksheet.kts");

  try {
    await writeFile(tempFile, instrumented.script, "utf8");
    const processResult = await runKotlincScript(
      options.kotlinCommand,
      tempFile,
      options.timeoutMs,
      options.cancellationSignal,
    );
    const results = processResult.exitCode === 0
      ? parseWorksheetOutput(processResult.stdout, instrumented.markerPrefix)
      : new Map<number, string>();
    const diagnostics = parseKotlinDiagnostics(processResult.stderr, instrumented.generatedLineToSourceLine);

    return {
      success: processResult.exitCode === 0 && !processResult.timedOut && !processResult.cancelled,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      results,
      diagnostics,
      timedOut: processResult.timedOut,
      cancelled: processResult.cancelled,
      startError: processResult.startError,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

function runKotlincScript(
  command: string,
  scriptPath: string,
  timeoutMs: number,
  cancellationSignal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    if (cancellationSignal?.aborted) {
      resolve({
        stdout: "",
        stderr: "Worksheet execution cancelled.",
        exitCode: null,
        timedOut: false,
        cancelled: true,
      });
      return;
    }

    const child = spawn(command, ["-script", scriptPath], {
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child.pid, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateChild(child.pid, "SIGKILL"), 1000);
    }, timeoutMs);

    const cancel = () => {
      cancelled = true;
      terminateChild(child.pid, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateChild(child.pid, "SIGKILL"), 1000);
    };
    cancellationSignal?.addEventListener("abort", cancel, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      cancellationSignal?.removeEventListener("abort", cancel);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        stdout,
        stderr: cancelled ? `${stderr}Worksheet execution cancelled.` : `${stderr}${error.message}`,
        exitCode: null,
        timedOut,
        cancelled,
        startError: cancelled ? undefined : error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        stdout,
        stderr: cancelled ? `${stderr}Worksheet execution cancelled.` : stderr,
        exitCode: code,
        timedOut,
        cancelled,
      });
    });
  });
}

function terminateChild(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have already exited.
    }
  }
}
