import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export interface DaemonProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs?: number;
  startError?: string;
}

export interface DaemonExecutionOptions {
  scriptPath: string;
  classpath?: string[];
  timeoutMs: number;
  cancellationSignal?: AbortSignal;
}

interface PendingRequest {
  id: string;
  resolve: (result: DaemonProcessResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  cancellationListener?: () => void;
}

export class KotlinDaemonClient {
  private childProcess: ChildProcess | null = null;
  private stdoutBuffer = "";
  private pendingRequests = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private readinessPromise: Promise<void> | null = null;
  private readinessResolve: (() => void) | null = null;
  private readinessReject: ((err: Error) => void) | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly jarPathOverride?: string,
    private readonly kotlinHomeOverride?: string,
    private readonly javaExecutableOverride?: string,
    private readonly idleTimeoutMs: number = 15 * 60 * 1000,
  ) {}

  public get isRunning(): boolean {
    return this.childProcess !== null && this.childProcess.exitCode === null;
  }

  public getDaemonJarPath(): string | undefined {
    if (this.jarPathOverride && existsSync(this.jarPathOverride)) {
      return this.jarPathOverride;
    }

    const candidates = [
      path.resolve(__dirname, "..", "server", "bin", "kotlin-worksheet-daemon.jar"),
      path.resolve(__dirname, "server", "bin", "kotlin-worksheet-daemon.jar"),
      path.resolve(process.cwd(), "server", "bin", "kotlin-worksheet-daemon.jar"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  public getKotlinHome(kotlinCommand = "kotlinc"): string | undefined {
    if (this.kotlinHomeOverride && existsSync(this.kotlinHomeOverride)) {
      return this.kotlinHomeOverride;
    }

    if (process.env.KOTLIN_HOME && existsSync(process.env.KOTLIN_HOME)) {
      const home = process.env.KOTLIN_HOME;
      if (existsSync(path.join(home, "lib", "kotlin-compiler.jar"))) {
        return home;
      }
    }

    return findKotlinHomeFromPath(kotlinCommand);
  }

  public getJavaExecutable(): string {
    if (this.javaExecutableOverride) {
      return this.javaExecutableOverride;
    }

    if (process.env.JAVA_HOME) {
      const javaBin = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
      if (existsSync(javaBin)) {
        return javaBin;
      }
    }

    return "java";
  }

  public isAvailable(kotlinCommand = "kotlinc"): boolean {
    const jar = this.getDaemonJarPath();
    const kotlinHome = this.getKotlinHome(kotlinCommand);
    return Boolean(jar && kotlinHome);
  }

  public async start(kotlinCommand = "kotlinc"): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
    }

    if (this.isRunning) {
      return this.readinessPromise ?? Promise.resolve();
    }

    const jarPath = this.getDaemonJarPath();
    if (!jarPath) {
      throw new Error("Kotlin worksheet daemon JAR not found");
    }

    const kotlinHome = this.getKotlinHome(kotlinCommand);
    if (!kotlinHome) {
      throw new Error(`Kotlin home directory could not be resolved from command '${kotlinCommand}'`);
    }

    const preloaderJar = path.join(kotlinHome, "lib", "kotlin-preloader.jar");
    const compilerJar = path.join(kotlinHome, "lib", "kotlin-compiler.jar");
    if (!existsSync(preloaderJar) || !existsSync(compilerJar)) {
      throw new Error(`Required Kotlin libraries missing from ${kotlinHome}/lib`);
    }

    const javaCmd = this.getJavaExecutable();
    const javaArgs = [
      `-Dkotlin.home=${kotlinHome}`,
      "-cp",
      preloaderJar,
      "org.jetbrains.kotlin.preloading.Preloader",
      "-cp",
      `${compilerJar}${path.delimiter}${jarPath}`,
      "KotlinWorksheetDaemon",
    ];

    this.isShuttingDown = false;
    this.readinessPromise = new Promise<void>((resolve, reject) => {
      this.readinessResolve = resolve;
      this.readinessReject = reject;
    });

    let child: ChildProcess;
    try {
      child = spawn(javaCmd, javaArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, KOTLIN_HOME: kotlinHome },
      });
      this.childProcess = child;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.childProcess = null;
      this.readinessReject?.(error);
      throw error;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.childProcess !== child) return;
      this.handleStdout(chunk);
    });
    child.stderr?.on("data", () => {
      // Background diagnostic stderr can be inspected if needed
    });

    child.on("error", (err) => {
      if (this.childProcess !== child) return;
      if (this.readinessReject) {
        this.readinessReject(err);
        this.readinessResolve = null;
        this.readinessReject = null;
      }
      this.failAllPending(err.message);
    });

    child.on("exit", (code) => {
      if (this.childProcess !== child) return;
      this.failAllPending(`Daemon process exited prematurely with code ${code}`);
      this.childProcess = null;
      this.readinessPromise = null;
      this.clearIdleTimer();
    });

    this.resetIdleTimer();
    return this.readinessPromise;
  }

  public async executeScript(
    options: DaemonExecutionOptions,
    kotlinCommand = "kotlinc",
  ): Promise<DaemonProcessResult> {
    if (options.cancellationSignal?.aborted) {
      return {
        stdout: "",
        stderr: "Execution cancelled",
        exitCode: null,
        timedOut: false,
        cancelled: true,
      };
    }

    await this.start(kotlinCommand);

    if (options.cancellationSignal?.aborted) {
      return {
        stdout: "",
        stderr: "Execution cancelled",
        exitCode: null,
        timedOut: false,
        cancelled: true,
      };
    }

    this.resetIdleTimer();

    const id = `req-${this.nextRequestId++}`;
    const compilerArgs: string[] = [];
    if (options.classpath && options.classpath.length > 0) {
      compilerArgs.push("-classpath", options.classpath.join(path.delimiter));
    }
    compilerArgs.push("-script", options.scriptPath);

    return new Promise<DaemonProcessResult>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      let cancellationListener: (() => void) | undefined;

      if (options.cancellationSignal?.aborted) {
        resolve({
          stdout: "",
          stderr: "Execution cancelled",
          exitCode: null,
          timedOut: false,
          cancelled: true,
        });
        return;
      }

      if (options.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          if (cancellationListener && options.cancellationSignal) {
            options.cancellationSignal.removeEventListener("abort", cancellationListener);
          }
          void this.shutdown();
          resolve({
            stdout: "",
            stderr: "Execution timed out",
            exitCode: null,
            timedOut: true,
            cancelled: false,
          });
        }, options.timeoutMs);
      }

      if (options.cancellationSignal) {
        cancellationListener = () => {
          this.pendingRequests.delete(id);
          if (timer) {
            clearTimeout(timer);
          }
          void this.shutdown();
          resolve({
            stdout: "",
            stderr: "Execution cancelled",
            exitCode: null,
            timedOut: false,
            cancelled: true,
          });
        };
        options.cancellationSignal.addEventListener("abort", cancellationListener, { once: true });
      }

      this.pendingRequests.set(id, {
        id,
        resolve: (res) => {
          if (timer) clearTimeout(timer);
          if (cancellationListener && options.cancellationSignal) {
            options.cancellationSignal.removeEventListener("abort", cancellationListener);
          }
          resolve(res);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          if (cancellationListener && options.cancellationSignal) {
            options.cancellationSignal.removeEventListener("abort", cancellationListener);
          }
          reject(err);
        },
        timer,
        cancellationListener,
      });

      const payload = JSON.stringify({ id, args: compilerArgs }) + "\n";
      this.childProcess?.stdin?.write(payload);
    });
  }

  public async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.clearIdleTimer();
    this.isShuttingDown = true;

    if (!this.childProcess) {
      this.isShuttingDown = false;
      return;
    }

    const proc = this.childProcess;
    this.childProcess = null;
    this.readinessPromise = null;

    this.shutdownPromise = (async () => {
      try {
        proc.stdin?.write(JSON.stringify({ command: "shutdown" }) + "\n");
      } catch {
        // Process might already be dead
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            proc.kill("SIGTERM");
          } catch {
            // ignore
          }
          resolve();
        }, 1000);

        proc.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    })().finally(() => {
      this.shutdownPromise = null;
      this.isShuttingDown = false;
    });

    return this.shutdownPromise;
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString("utf8");
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if (msg.type === "ready") {
          if (this.readinessResolve) {
            this.readinessResolve();
            this.readinessResolve = null;
            this.readinessReject = null;
          }
          continue;
        }

        if (msg.id && this.pendingRequests.has(msg.id)) {
          const req = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          req.resolve({
            stdout: msg.stdout ?? "",
            stderr: msg.stderr ?? "",
            exitCode: typeof msg.exitCode === "number" ? msg.exitCode : null,
            timedOut: false,
            cancelled: false,
            durationMs: msg.durationMs,
          });
        }
      } catch {
        // Non-JSON output ignored
      }
    }
  }

  private failAllPending(errorMessage: string): void {
    for (const [, req] of this.pendingRequests) {
      if (req.timer) clearTimeout(req.timer);
      req.resolve({
        stdout: "",
        stderr: errorMessage,
        exitCode: null,
        timedOut: false,
        cancelled: false,
        startError: errorMessage,
      });
    }
    this.pendingRequests.clear();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.pendingRequests.size === 0) {
          void this.shutdown();
        }
      }, this.idleTimeoutMs);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

export function findKotlinHomeFromPath(cmd = "kotlinc"): string | undefined {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  const extensions = process.platform === "win32" ? ["", ".bat", ".cmd", ".exe"] : [""];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      try {
        if (existsSync(candidate)) {
          const real = realpathSync(candidate);
          const home = path.resolve(path.dirname(real), "..");
          if (existsSync(path.join(home, "lib", "kotlin-compiler.jar"))) {
            return home;
          }
        }
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

let sharedDaemonClient: KotlinDaemonClient | null = null;

export function getSharedKotlinDaemonClient(): KotlinDaemonClient {
  if (!sharedDaemonClient) {
    sharedDaemonClient = new KotlinDaemonClient();
  }
  return sharedDaemonClient;
}

export async function shutdownSharedKotlinDaemon(): Promise<void> {
  if (sharedDaemonClient) {
    await sharedDaemonClient.shutdown();
    sharedDaemonClient = null;
  }
}
