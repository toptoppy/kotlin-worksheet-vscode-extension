import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import {
  detectMavenCommand,
  resolveMavenClasspath,
  type MavenClasspathResult,
  type MavenCommand,
  type MavenResolveOptions,
} from "./maven.js";

export type MavenClasspathCacheStatus = "hit" | "miss" | "invalidated" | "shared" | "disabled";

export interface CachedMavenClasspathResult extends MavenClasspathResult {
  cacheStatus: MavenClasspathCacheStatus;
}

export interface MavenClasspathCacheOptions extends MavenResolveOptions {
  enabled?: boolean;
}

interface MavenClasspathCacheEntry {
  fingerprint: string;
  result: MavenClasspathResult;
}

interface MavenClasspathCacheRequest {
  id: number;
  key: string;
  fingerprint: string;
  promise: Promise<CachedMavenClasspathResult>;
}

interface MavenClasspathCacheDependencies {
  detectCommand?: typeof detectMavenCommand;
  resolveClasspath?: typeof resolveMavenClasspath;
  fingerprint?: (projectRoot: string, worksheetDir?: string) => Promise<string>;
}

export class MavenClasspathCache {
  private entries = new Map<string, MavenClasspathCacheEntry>();
  private inFlight = new Map<string, MavenClasspathCacheRequest>();
  private nextRequestId = 0;
  private readonly detectCommand: typeof detectMavenCommand;
  private readonly resolveClasspath: typeof resolveMavenClasspath;
  private readonly fingerprint: (projectRoot: string, worksheetDir?: string) => Promise<string>;

  constructor(dependencies: MavenClasspathCacheDependencies = {}) {
    this.detectCommand = dependencies.detectCommand ?? detectMavenCommand;
    this.resolveClasspath = dependencies.resolveClasspath ?? resolveMavenClasspath;
    this.fingerprint = dependencies.fingerprint ?? fingerprintMavenProject;
  }

  async resolve(
    projectRoot: string,
    options: MavenClasspathCacheOptions,
  ): Promise<CachedMavenClasspathResult> {
    if (options.enabled === false) {
      return withCacheStatus(await this.resolveClasspath(projectRoot, options), "disabled");
    }

    const command = await this.detectCommand(projectRoot, options.cancellationSignal);
    const key = cacheKey(projectRoot, options.worksheetDir, command);
    const fingerprint = await this.fingerprint(projectRoot, options.worksheetDir);

    const cached = this.entries.get(key);
    if (cached) {
      if (cached.fingerprint === fingerprint) {
        return withCacheStatus(cached.result, "hit");
      }
      this.entries.delete(key);
    }

    const inFlightRequest = this.inFlight.get(key);
    if (inFlightRequest && inFlightRequest.fingerprint === fingerprint) {
      return withCacheStatus(await inFlightRequest.promise, "shared");
    }

    const requestId = ++this.nextRequestId;
    const requestPromise = (async () => {
      const result = await this.resolveClasspath(projectRoot, options);
      if (result.success && result.classpath.length > 0) {
        this.entries.set(key, { fingerprint, result });
      }
      return withCacheStatus(result, cached ? "invalidated" : "miss");
    })();

    this.inFlight.set(key, { id: requestId, key, fingerprint, promise: requestPromise });

    try {
      return await requestPromise;
    } finally {
      const current = this.inFlight.get(key);
      if (current?.id === requestId) {
        this.inFlight.delete(key);
      }
    }
  }

  clear(projectRoot?: string, worksheetDir?: string): number {
    const prefix = projectRoot
      ? `${path.resolve(projectRoot)}\u0000${worksheetDir ? `${path.resolve(worksheetDir)}\u0000` : ""}`
      : undefined;
    let cleared = 0;
    const keys = new Set([...this.entries.keys(), ...this.inFlight.keys()]);
    for (const key of keys) {
      if (!prefix || key.startsWith(prefix)) {
        if (this.entries.delete(key)) {
          cleared += 1;
        }
        this.inFlight.delete(key);
      }
    }
    return cleared;
  }

  invalidate(projectRoot: string): void {
    const prefix = `${path.resolve(projectRoot)}\u0000`;
    for (const [key] of this.entries) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }
}

function withCacheStatus(
  result: MavenClasspathResult,
  cacheStatus: MavenClasspathCacheStatus,
): CachedMavenClasspathResult {
  return { ...result, cacheStatus };
}

function cacheKey(projectRoot: string, worksheetDir?: string, command?: MavenCommand): string {
  const root = path.resolve(projectRoot);
  const worksheet = worksheetDir ? path.resolve(worksheetDir) : root;
  const cmd = command ? `${command.command}:${command.args.join(" ")}` : "missing";
  return `${root}\u0000${worksheet}\u0000${cmd}`;
}

export async function fingerprintMavenProject(projectRoot: string, _worksheetDir?: string): Promise<string> {
  const parts: string[] = [];
  const pomPath = path.join(projectRoot, "pom.xml");

  try {
    const pomStat = await stat(pomPath);
    parts.push(`pom:${pomStat.size}:${pomStat.mtimeMs}`);
  } catch {
    parts.push("pom:missing");
  }

  // Check wrapper
  const wrapper = path.join(projectRoot, process.platform === "win32" ? "mvnw.cmd" : "mvnw");
  try {
    await access(wrapper, fsConstants.F_OK);
    parts.push("wrapper:present");
  } catch {
    parts.push("wrapper:none");
  }

  // Check parent pom if this is a sub-module
  const parentPom = path.join(path.dirname(projectRoot), "pom.xml");
  try {
    const parentStat = await stat(parentPom);
    parts.push(`parentPom:${parentStat.size}:${parentStat.mtimeMs}`);
  } catch {
    // not a subproject with parent pom
  }

  return parts.join("|");
}
