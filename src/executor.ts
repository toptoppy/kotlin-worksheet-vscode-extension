import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCapturedCommand } from "./process.js";
import type { WorksheetDiagnostic } from "./worksheet.js";
import {
  instrumentWorksheet,
  parseKotlinDiagnostics,
  parseWorksheetOutputDetails,
  stripWorksheetMarkers,
  type WorksheetRange,
} from "./worksheet.js";

export interface KotlinWorksheetExecution {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  results: Map<number, string>;
  runtimeOutput: string;
  diagnostics: WorksheetDiagnostic[];
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

export interface KotlinWorksheetExecutionOptions {
  kotlinCommand: string;
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
  classpath?: string[];
  resultRange?: WorksheetRange;
}

export async function executeWorksheet(
  source: string,
  options: KotlinWorksheetExecutionOptions,
): Promise<KotlinWorksheetExecution> {
  const instrumented = instrumentWorksheet(source, undefined, { resultRange: options.resultRange });
  const tempDir = await mkdtemp(path.join(tmpdir(), "kotlin-worksheet-"));
  const tempFile = path.join(tempDir, "worksheet.kts");

  try {
    await writeFile(tempFile, instrumented.script, "utf8");
    const processResult = await runKotlincScript(
      options.kotlinCommand,
      tempFile,
      options.timeoutMs,
      options.cancellationSignal,
      options.classpath,
    );
    const output = processResult.exitCode === 0
      ? parseWorksheetOutputDetails(processResult.stdout, instrumented.markerPrefix)
      : { results: new Map<number, string>(), runtimeOutput: "" };
    const diagnostics = parseKotlinDiagnostics(processResult.stderr, instrumented.generatedLineToSourceLine);

    return {
      success: processResult.exitCode === 0 && !processResult.timedOut && !processResult.cancelled,
      stdout: stripWorksheetMarkers(processResult.stdout, instrumented.markerPrefix),
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      results: output.results,
      runtimeOutput: output.runtimeOutput.trimEnd(),
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
  classpath: string[] = [],
): Promise<ProcessResult> {
  const args = classpath.length > 0
    ? ["-classpath", classpath.join(path.delimiter), "-script", scriptPath]
    : ["-script", scriptPath];

  return runCapturedCommand({
    command,
    args,
    timeoutMs,
    cancellationSignal,
  });
}
