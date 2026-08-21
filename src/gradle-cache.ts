import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  detectGradleCommand,
  resolveGradleClasspath,
  type GradleClasspathResult,
  type GradleCommand,
  type GradleResolveOptions,
} from "./gradle.js";

export type GradleClasspathCacheStatus = "hit" | "miss" | "invalidated" | "shared" | "disabled";

export interface CachedGradleClasspathResult extends GradleClasspathResult {
  cacheStatus: GradleClasspathCacheStatus;
}

export interface GradleClasspathCacheOptions extends GradleResolveOptions {
  enabled?: boolean;
}

interface GradleClasspathCacheEntry {
  fingerprint: string;
  result: GradleClasspathResult;
}

interface GradleClasspathCacheRequest {
  id: number;
  key: string;
  fingerprint: string;
  promise: Promise<CachedGradleClasspathResult>;
}

interface GradleClasspathCacheDependencies {
  detectCommand?: typeof detectGradleCommand;
  resolveClasspath?: typeof resolveGradleClasspath;
  fingerprint?: (projectRoot: string, worksheetDir?: string) => Promise<string>;
}

const FINGERPRINT_SKIP_DIRECTORIES = new Set([
  ".gradle",
  ".git",
  ".idea",
  "build",
  "bin",
  "out",
  "target",
  "dist",
  "coverage",
  "node_modules",
]);

export class GradleClasspathCache {
  private entries = new Map<string, GradleClasspathCacheEntry>();
  private inFlight = new Map<string, GradleClasspathCacheRequest>();
  private generations = new Map<string, number>();
  private refreshEpoch = 0;
  private projectRefreshEpochs = new Map<string, number>();
  private worksheetRefreshEpochs = new Map<string, number>();
  private nextRequestId = 0;
  private readonly detectCommand: typeof detectGradleCommand;
  private readonly resolveClasspath: typeof resolveGradleClasspath;
  private readonly fingerprint: (projectRoot: string, worksheetDir?: string) => Promise<string>;

  constructor(dependencies: GradleClasspathCacheDependencies = {}) {
    this.detectCommand = dependencies.detectCommand ?? detectGradleCommand;
    this.resolveClasspath = dependencies.resolveClasspath ?? resolveGradleClasspath;
    this.fingerprint = dependencies.fingerprint ?? fingerprintGradleProject;
  }

  async resolve(
    projectRoot: string,
    options: GradleClasspathCacheOptions,
  ): Promise<CachedGradleClasspathResult> {
    if (options.enabled === false) {
      return withCacheStatus(await this.resolveClasspath(projectRoot, options), "disabled");
    }

    const resolvedProjectRoot = path.resolve(projectRoot);
    const resolvedWorksheetDir = options.worksheetDir ? path.resolve(options.worksheetDir) : undefined;
    const refreshEpoch = this.refreshEpoch;
    const projectRefreshEpoch = this.projectRefreshEpochs.get(resolvedProjectRoot) ?? 0;
    const worksheetRefreshKey = resolvedWorksheetDir
      ? refreshScopeKey(resolvedProjectRoot, resolvedWorksheetDir)
      : undefined;
    const worksheetRefreshEpoch = worksheetRefreshKey
      ? this.worksheetRefreshEpochs.get(worksheetRefreshKey) ?? 0
      : 0;
    const isCurrentRefresh = () => refreshEpoch === this.refreshEpoch
      && projectRefreshEpoch === (this.projectRefreshEpochs.get(resolvedProjectRoot) ?? 0)
      && worksheetRefreshEpoch === (worksheetRefreshKey
        ? this.worksheetRefreshEpochs.get(worksheetRefreshKey) ?? 0
        : 0);

    const command = await this.detectCommand(projectRoot, options.cancellationSignal);
    const key = cacheKey(projectRoot, options.worksheetDir, command);
    const fingerprint = await this.fingerprint(projectRoot, options.worksheetDir);
    if (!isCurrentRefresh()) {
      return withCacheStatus(await this.resolveClasspath(projectRoot, options), "miss");
    }
    const entry = this.entries.get(key);
    if (entry?.fingerprint === fingerprint) {
      return withCacheStatus(entry.result, "hit");
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight?.fingerprint === fingerprint) {
      const result = await inFlight.promise;
      return { ...result, cacheStatus: "shared" };
    }

    const status: GradleClasspathCacheStatus = entry ? "invalidated" : "miss";
    const generation = this.generations.get(key) ?? 0;
    const requestId = ++this.nextRequestId;
    const promise = this.resolveClasspath(projectRoot, options)
      .then((result) => {
        const isCurrentRequest = this.inFlight.get(key)?.id === requestId;
        const canPopulate = isCurrentRequest
          && generation === (this.generations.get(key) ?? 0)
          && isCurrentRefresh();
        if (canPopulate && result.success && result.classpath.length > 0) {
          this.entries.set(key, { fingerprint, result });
        } else if (canPopulate) {
          this.entries.delete(key);
        }
        return withCacheStatus(result, status);
      })
      .finally(() => {
        if (this.inFlight.get(key)?.id === requestId) {
          this.inFlight.delete(key);
        }
      });

    this.inFlight.set(key, { id: requestId, key, fingerprint, promise });
    return await promise;
  }

  clear(projectRoot?: string, worksheetDir?: string): number {
    if (!projectRoot) {
      this.refreshEpoch += 1;
    } else {
      const resolvedProjectRoot = path.resolve(projectRoot);
      if (worksheetDir) {
        const scopeKey = refreshScopeKey(resolvedProjectRoot, path.resolve(worksheetDir));
        this.worksheetRefreshEpochs.set(scopeKey, (this.worksheetRefreshEpochs.get(scopeKey) ?? 0) + 1);
      } else {
        this.projectRefreshEpochs.set(
          resolvedProjectRoot,
          (this.projectRefreshEpochs.get(resolvedProjectRoot) ?? 0) + 1,
        );
      }
    }
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
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      }
    }
    return cleared;
  }
}

export async function fingerprintGradleProject(projectRoot: string, worksheetDir?: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const files = await collectFingerprintFiles(root, worksheetDir ? path.resolve(worksheetDir) : root);
  const parts = await Promise.all(files.sort().map(async (file) => {
    const fileStat = await stat(file);
    return `${path.relative(root, file)}:${fileStat.mtimeMs}:${fileStat.size}`;
  }));
  return parts.join("|");
}

async function collectFingerprintFiles(projectRoot: string, worksheetDir: string): Promise<string[]> {
  const files: string[] = [];
  const buildConfigFiles = [
    "settings.gradle",
    "settings.gradle.kts",
    "build.gradle",
    "build.gradle.kts",
    "gradle.properties",
    "gradle.lockfile",
  ];
  const rootFixedFiles = [
    ...buildConfigFiles,
    path.join("gradle", "wrapper", "gradle-wrapper.jar"),
    path.join("gradle", "wrapper", "gradle-wrapper.properties"),
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  ];

  for (const relative of rootFixedFiles) {
    const file = path.join(projectRoot, relative);
    if (await exists(file)) {
      files.push(file);
    }
  }

  for (const ancestor of projectAncestors(projectRoot, worksheetDir)) {
    for (const relative of buildConfigFiles) {
      const file = path.join(ancestor, relative);
      if (await exists(file)) {
        files.push(file);
      }
    }

    const sourceRoots = [
      path.basename(ancestor) === "src" ? ancestor : undefined,
      path.join(ancestor, "src"),
    ];
    for (const sourceRoot of sourceRoots) {
      if (sourceRoot && await exists(sourceRoot)) {
        files.push(...await collectFiles(sourceRoot));
      }
    }
  }

  const gradleDir = path.join(projectRoot, "gradle");
  if (await exists(gradleDir)) {
    files.push(...await collectFiles(gradleDir));
  }

  for (const projectDir of await discoverGradleProjectDirs(projectRoot, buildConfigFiles)) {
    for (const relative of buildConfigFiles) {
      const file = path.join(projectDir, relative);
      if (await exists(file)) {
        files.push(file);
      }
    }

    for (const sourceRoot of [path.join(projectDir, "src"), path.join(projectDir, "buildSrc")]) {
      if (await exists(sourceRoot)) {
        files.push(...await collectFiles(sourceRoot));
      }
    }

    const projectGradleDir = path.join(projectDir, "gradle");
    if (await exists(projectGradleDir)) {
      files.push(...await collectFiles(projectGradleDir));
    }
  }

  const sourceRoots = [path.join(projectRoot, "src"), path.join(projectRoot, "buildSrc")];
  for (const sourceRoot of new Set(sourceRoots)) {
    if (await exists(sourceRoot)) {
      files.push(...await collectFiles(sourceRoot));
    }
  }

  return [...new Set(files)];
}

function projectAncestors(projectRoot: string, worksheetDir: string): string[] {
  if (!isWithinProject(projectRoot, worksheetDir)) {
    return [];
  }

  const ancestors: string[] = [];
  let current = worksheetDir;
  while (true) {
    ancestors.push(current);
    if (current === projectRoot) {
      return ancestors;
    }
    current = path.dirname(current);
  }
}

function isWithinProject(projectRoot: string, candidate: string): boolean {
  const relative = path.relative(projectRoot, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipFingerprintDirectory(entry.name)) {
        continue;
      }
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function discoverGradleProjectDirs(projectRoot: string, buildConfigFiles: string[]): Promise<string[]> {
  const projectDirs: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && buildConfigFiles.includes(entry.name))) {
      projectDirs.push(dir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipFingerprintDirectory(entry.name)) {
        continue;
      }
      if (entry.name === "src" || entry.name === "buildSrc" || entry.name === "gradle") {
        continue;
      }
      await visit(path.join(dir, entry.name));
    }
  }

  await visit(projectRoot);
  return projectDirs;
}

function shouldSkipFingerprintDirectory(name: string): boolean {
  return FINGERPRINT_SKIP_DIRECTORIES.has(name);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function cacheKey(projectRoot: string, worksheetDir: string | undefined, command: GradleCommand | undefined): string {
  return [
    path.resolve(projectRoot),
    worksheetDir ? path.resolve(worksheetDir) : "",
    command?.command ?? "",
    ...(command?.args ?? []),
  ].join("\u0000");
}

function refreshScopeKey(projectRoot: string, worksheetDir: string): string {
  return `${projectRoot}\u0000${worksheetDir}`;
}

function withCacheStatus(
  result: GradleClasspathResult,
  cacheStatus: GradleClasspathCacheStatus,
): CachedGradleClasspathResult {
  return { ...result, classpath: [...result.classpath], cacheStatus };
}
