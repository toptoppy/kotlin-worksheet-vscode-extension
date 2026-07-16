import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { runVSCodeCommand } from "@vscode/test-electron";

const workspaceRoot = process.cwd();
const manifest = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
const vsixPath = path.join(workspaceRoot, `${manifest.name}-${manifest.version}.vsix`);
await access(vsixPath);

const profileRoot = await mkdtemp(path.join(tmpdir(), "kotlin-worksheet-vsix-"));
const userDataDir = path.join(profileRoot, "user-data");
const extensionsDir = path.join(profileRoot, "extensions");
await mkdir(userDataDir);
await mkdir(extensionsDir);

const profileArgs = [
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
];
const expectedExtension = `${manifest.publisher}.${manifest.name}@${manifest.version}`.toLowerCase();

try {
  const install = await runVSCodeCommand([
    ...profileArgs,
    "--install-extension",
    vsixPath,
    "--force",
  ]);
  process.stdout.write(install.stdout);
  process.stderr.write(install.stderr);

  const installed = await runVSCodeCommand([
    ...profileArgs,
    "--list-extensions",
    "--show-versions",
  ]);
  process.stdout.write(installed.stdout);
  process.stderr.write(installed.stderr);

  const installedExtensions = installed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (!installedExtensions.includes(expectedExtension)) {
    throw new Error(`Expected ${expectedExtension} in installed extensions: ${installedExtensions.join(", ")}`);
  }
} finally {
  await rm(profileRoot, { recursive: true, force: true });
}
