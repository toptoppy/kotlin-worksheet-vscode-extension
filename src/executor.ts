import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  WorksheetDiagnostic,
  instrumentWorksheet,
  parseKotlinDiagnostics,
  parseWorksheetOutput,
} from "./worksheet.js";

export interface KotlinWorksheetExecution {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  results: Map<number, string>;
  diagnostics: WorksheetDiagnostic[];
  timedOut: boolean;
}

export interface KotlinWorksheetExecutionOptions {
  kotlinCommand: string;
  timeoutMs: number;
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
    const processResult = await runKotlincScript(options.kotlinCommand, tempFile, options.timeoutMs);
    const results = processResult.exitCode === 0
      ? parseWorksheetOutput(processResult.stdout, instrumented.markerPrefix)
      : new Map<number, string>();
    const diagnostics = parseKotlinDiagnostics(processResult.stderr, instrumented.generatedLineToSourceLine);

    return {
      success: processResult.exitCode === 0 && !processResult.timedOut,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      results,
      diagnostics,
      timedOut: processResult.timedOut,
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
}

function runKotlincScript(command: string, scriptPath: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-script", scriptPath], {
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

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
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr: `${stderr}${error.message}`,
        exitCode: null,
        timedOut,
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
      });
    });
  });
}
