export type WorksheetRunStatus =
  | "idle"
  | "preparing"
  | "resolving"
  | "running"
  | "applying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timedOut";

export interface WorksheetRunState {
  status: WorksheetRunStatus;
  startedAt?: number;
  durationMs?: number;
  executionMode?: "localKotlinc" | "gradleClasspath";
}

export interface WorksheetRunHandle {
  cancellationSignal: AbortSignal;
}

interface ActiveWorksheetRun {
  abortController: AbortController;
  startedAt: number;
}

const terminalStatuses = new Set<WorksheetRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "timedOut",
]);

export class WorksheetRunRegistry {
  private readonly activeRuns = new Map<string, ActiveWorksheetRun>();
  private readonly states = new Map<string, WorksheetRunState>();
  private readonly listeners = new Set<(uri: string, state: WorksheetRunState) => void>();

  public constructor(private readonly now: () => number = Date.now) {}

  public begin(uri: string): WorksheetRunHandle | undefined {
    if (this.activeRuns.has(uri)) {
      return undefined;
    }

    const startedAt = this.now();
    const abortController = new AbortController();
    this.activeRuns.set(uri, { abortController, startedAt });
    this.states.set(uri, { status: "preparing", startedAt });
    this.emit(uri);
    return { cancellationSignal: abortController.signal };
  }

  public transition(uri: string, status: WorksheetRunStatus): void {
    const activeRun = this.activeRuns.get(uri);
    if (!activeRun || terminalStatuses.has(status) || status === "idle") {
      return;
    }

    const current = this.states.get(uri);
    this.states.set(uri, {
      status,
      startedAt: activeRun.startedAt,
      ...(current?.executionMode ? { executionMode: current.executionMode } : {}),
    });
    this.emit(uri);
  }

  public setExecutionMode(uri: string, executionMode: "localKotlinc" | "gradleClasspath"): void {
    const state = this.states.get(uri);
    if (!state || !this.activeRuns.has(uri)) {
      return;
    }

    this.states.set(uri, { ...state, executionMode });
    this.emit(uri);
  }

  public finish(uri: string, status: Extract<WorksheetRunStatus, "succeeded" | "failed" | "cancelled" | "timedOut">): void {
    const activeRun = this.activeRuns.get(uri);
    if (!activeRun) {
      return;
    }

    this.activeRuns.delete(uri);
    const current = this.states.get(uri);
    this.states.set(uri, {
      status,
      startedAt: activeRun.startedAt,
      durationMs: Math.max(0, this.now() - activeRun.startedAt),
      ...(current?.executionMode ? { executionMode: current.executionMode } : {}),
    });
    this.emit(uri);
  }

  public cancel(uri: string): boolean {
    const activeRun = this.activeRuns.get(uri);
    if (!activeRun) {
      return false;
    }

    activeRun.abortController.abort();
    return true;
  }

  public isRunning(uri: string): boolean {
    return this.activeRuns.has(uri);
  }

  public getState(uri: string): WorksheetRunState {
    return this.states.get(uri) ?? { status: "idle" };
  }

  public onDidChange(listener: (uri: string, state: WorksheetRunState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    for (const run of this.activeRuns.values()) {
      run.abortController.abort();
    }
    this.activeRuns.clear();
    this.states.clear();
    this.listeners.clear();
  }

  private emit(uri: string): void {
    const state = this.getState(uri);
    for (const listener of this.listeners) {
      listener(uri, state);
    }
  }
}
