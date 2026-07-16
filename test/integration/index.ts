import { runTests } from "@vscode/test-electron";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "kws-userdata-"));
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "kws-workspace-"));

  // Pre-create workspace .vscode/settings.json so config.update(WorkspaceTarget)
  // succeeds in tests that toggle settings.
  mkdirSync(path.join(workspaceDir, ".vscode"), { recursive: true });
  writeFileSync(path.join(workspaceDir, ".vscode", "settings.json"), "{}", "utf8");

  // Disable workspace trust in user settings so the extension doesn't bail
  // on the workspace trust guard in runWorksheetDocument.
  mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  writeFileSync(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify({ "security.workspace.trust.enabled": false }, null, 2),
    "utf8",
  );

  try {
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, "../../.."),
      extensionTestsPath: path.resolve(__dirname, "./suite/index"),
      launchArgs: [
        "--user-data-dir",
        userDataDir,
        "--folder-uri",
        `file://${workspaceDir}`,
      ],
    });
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main();
