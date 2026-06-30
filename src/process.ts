import { spawn } from "node:child_process";

export interface CapturedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  startError?: string;
}

export interface CapturedCommandOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
  cwd?: string;
  shell?: boolean;
  detached?: boolean;
}

export function runCapturedCommand(options: CapturedCommandOptions): Promise<CapturedCommandResult> {
  return new Promise((resolve) => {
    if (options.cancellationSignal?.aborted) {
      resolve({
        stdout: "",
        stderr: "Command execution cancelled.",
        exitCode: null,
        timedOut: false,
        cancelled: true,
      });
      return;
    }

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: options.shell ?? (process.platform === "win32"),
      detached: options.detached ?? (process.platform !== "win32"),
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
    }, options.timeoutMs);

    const cancel = () => {
      cancelled = true;
      terminateChild(child.pid, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateChild(child.pid, "SIGKILL"), 1000);
    };
    options.cancellationSignal?.addEventListener("abort", cancel, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      options.cancellationSignal?.removeEventListener("abort", cancel);
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
        stderr: cancelled ? `${stderr}Command execution cancelled.` : `${stderr}${error.message}`,
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
        stderr: cancelled ? `${stderr}Command execution cancelled.` : stderr,
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
