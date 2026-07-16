import type { WorksheetRunState, WorksheetRunStatus } from "./run-state.js";

export interface WorksheetStatusOptions {
  state: WorksheetRunState;
  runOnSave: boolean;
  requestedExecutionMode: "auto" | "localKotlinc" | "gradleClasspath";
}

export interface WorksheetStatusPresentation {
  text: string;
  tooltip: string;
  command: "kotlinWorksheet.cancelActiveRun" | "kotlinWorksheet.toggleRunOnSave";
}

const runningStatuses = new Set<WorksheetRunStatus>(["preparing", "resolving", "running", "applying"]);

export function buildWorksheetStatus(options: WorksheetStatusOptions): WorksheetStatusPresentation {
  const running = runningStatuses.has(options.state.status);
  const label = statusLabel(options.state.status);
  const mode = options.state.executionMode ?? options.requestedExecutionMode;
  const tooltip = [
    `Kotlin Worksheet: ${label}`,
    `Execution mode: ${mode}`,
    `Run on save: ${options.runOnSave ? "enabled" : "disabled"}`,
  ];

  if (options.state.durationMs !== undefined) {
    tooltip.push(`Last duration: ${formatDuration(options.state.durationMs)}`);
  }
  tooltip.push(running ? "Click to cancel this run." : "Click to toggle run on save.");

  return {
    text: statusText(options.state.status, options.runOnSave),
    tooltip: tooltip.join("\n"),
    command: running ? "kotlinWorksheet.cancelActiveRun" : "kotlinWorksheet.toggleRunOnSave",
  };
}

function statusLabel(status: WorksheetRunStatus): string {
  switch (status) {
    case "preparing":
      return "Preparing";
    case "resolving":
      return "Resolving dependencies";
    case "running":
      return "Running";
    case "applying":
      return "Applying results";
    case "succeeded":
      return "Passed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "timedOut":
      return "Timed Out";
    default:
      return "Ready";
  }
}

function statusText(status: WorksheetRunStatus, runOnSave: boolean): string {
  switch (status) {
    case "preparing":
    case "resolving":
    case "running":
    case "applying":
      return "$(sync~spin) Kotlin WS: Running";
    case "succeeded":
      return "$(pass-filled) Kotlin WS: Passed";
    case "failed":
      return "$(error) Kotlin WS: Failed";
    case "cancelled":
      return "$(circle-slash) Kotlin WS: Cancelled";
    case "timedOut":
      return "$(clock) Kotlin WS: Timed Out";
    default:
      return runOnSave ? "$(play-circle) Kotlin WS: Ready (Auto)" : "$(play) Kotlin WS: Ready";
  }
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}
