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

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let terminationReason: "timedOut" | "cancelled" | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const requestTermination = (reason: "timedOut" | "cancelled") => {
      if (settled || terminationReason) {
        return;
      }

      terminationReason = reason;
      terminateChild(child.pid, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateChild(child.pid, "SIGKILL"), 1000);
    };

    const timeout = setTimeout(() => requestTermination("timedOut"), options.timeoutMs);

    const cancel = () => requestTermination("cancelled");
    options.cancellationSignal?.addEventListener("abort", cancel, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      options.cancellationSignal?.removeEventListener("abort", cancel);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        stdout,
        stderr: terminationReason === "cancelled" ? `${stderr}Command execution cancelled.` : `${stderr}${error.message}`,
        exitCode: null,
        timedOut: terminationReason === "timedOut",
        cancelled: terminationReason === "cancelled",
        startError: terminationReason ? undefined : error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        stdout,
        stderr: terminationReason === "cancelled" ? `${stderr}Command execution cancelled.` : stderr,
        exitCode: code,
        timedOut: terminationReason === "timedOut",
        cancelled: terminationReason === "cancelled",
      });
    });
  });
}

function terminateChild(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      return;
    } catch {
      // Fall back to terminating the direct process below.
    }
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have already exited.
    }
  }
}
