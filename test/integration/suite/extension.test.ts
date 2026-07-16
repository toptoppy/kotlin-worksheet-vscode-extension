import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";

const kotlincPath = resolveCommand("kotlinc");
const hasKotlinc = Boolean(kotlincPath);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for extension state.");
    }
    await sleep(100);
  }
}

suite("Kotlin Worksheet Extension Test Suite", () => {
  let tempDir: string;

  setup(async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "Integration tests require a workspace folder");
    tempDir = await mkdtemp(path.join(workspaceRoot, "kws-int-"));
    await resetSettings();
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await resetSettings();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function openDocument(content: string, fileName: string): Promise<vscode.TextDocument> {
    const filePath = path.join(tempDir, fileName);
    await writeFile(filePath, content);
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await sleep(100);
    return document;
  }

  test("commands are registered without a duplicate rerun command", async () => {
    const ext = vscode.extensions.getExtension("ws-kts-toppy.kotlin-worksheet");
    assert.ok(ext, "Extension ws-kts-toppy.kotlin-worksheet must be found");
    if (!ext.isActive) {
      await ext.activate();
    }

    const commands = (await vscode.commands.getCommands(true)).filter((command) =>
      command.startsWith("kotlinWorksheet."),
    );

    assert.ok(commands.includes("kotlinWorksheet.run"));
    assert.ok(!commands.includes("kotlinWorksheet.rerun"));
    assert.ok(commands.includes("kotlinWorksheet.clearResults"));
    assert.ok(commands.includes("kotlinWorksheet.newWorksheet"));
    assert.ok(commands.includes("kotlinWorksheet.toggleRunOnSave"));
    assert.ok(commands.includes("kotlinWorksheet.toggleRenderMode"));
    assert.ok(commands.includes("kotlinWorksheet.openSetupGuide"));
    assert.ok(commands.includes("kotlinWorksheet.showOutput"));
    assert.ok(commands.includes("kotlinWorksheet.checkEnvironment"));
    assert.ok(commands.includes("kotlinWorksheet.cancelActiveRun"));
  });

  test("run on a non-worksheet file leaves it unchanged", async () => {
    const document = await openDocument("val x = 1", "plain.kts");

    await vscode.commands.executeCommand("kotlinWorksheet.run");

    assert.strictEqual(document.getText(), "val x = 1");
  });

  test("clear results removes inline comments and diagnostics", async () => {
    const document = await openDocument(
      "val a = 1 // => 1\nval b = 2 // => 2\nval c = 3",
      "clear-test.worksheet.kts",
    );

    await vscode.commands.executeCommand("kotlinWorksheet.clearResults");

    assert.strictEqual(document.getText(), "val a = 1\nval b = 2\nval c = 3");
    assert.strictEqual(vscode.languages.getDiagnostics(document.uri).length, 0);
  });

  test("render mode switching removes inline results", async () => {
    const document = await openDocument("val x = 1 // => 1", "toggle-render.worksheet.kts");

    const firstMode = await vscode.commands.executeCommand<string>("kotlinWorksheet.toggleRenderMode");

    assert.strictEqual(firstMode, "decorations");
    assert.strictEqual(
      vscode.workspace.getConfiguration("kotlinWorksheet", document.uri).get("renderMode"),
      "decorations",
    );
    assert.strictEqual(document.getText(), "val x = 1");

    await sleep(100);
    const secondMode = await vscode.commands.executeCommand<string>("kotlinWorksheet.toggleRenderMode");
    assert.strictEqual(secondMode, "inlineComments");
    assert.strictEqual(
      vscode.workspace.getConfiguration("kotlinWorksheet", document.uri).get("renderMode"),
      "inlineComments",
    );
  });

  test("run-on-save toggles as a workspace setting", async () => {
    const document = await openDocument("val x = 1", "toggle-save.worksheet.kts");
    const config = vscode.workspace.getConfiguration("kotlinWorksheet", document.uri);

    assert.strictEqual(config.get("runOnSave"), false);
    const enabled = await vscode.commands.executeCommand<boolean>("kotlinWorksheet.toggleRunOnSave");
    assert.strictEqual(enabled, true);
    assert.strictEqual(
      vscode.workspace.getConfiguration("kotlinWorksheet", document.uri).get("runOnSave"),
      true,
    );
  });

  test("new worksheet creates a file in the workspace", async () => {
    const priorFilenames = new Set(vscode.workspace.textDocuments.map((document) => document.fileName));

    await vscode.commands.executeCommand("kotlinWorksheet.newWorksheet");

    const newDocument = vscode.workspace.textDocuments.find(
      (document) => document.fileName.endsWith(".worksheet.kts") && !priorFilenames.has(document.fileName),
    );
    assert.ok(newDocument, "Expected a new worksheet document to be created");
    assert.strictEqual(path.dirname(newDocument.fileName), vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  });

  test("new worksheet honors a selected folder in a multi-root workspace", async () => {
    const secondRoot = await mkdtemp(path.join(tmpdir(), "kws-second-root-"));
    const insertionIndex = vscode.workspace.workspaceFolders?.length ?? 1;
    try {
      assert.strictEqual(vscode.workspace.updateWorkspaceFolders(insertionIndex, 0, { uri: vscode.Uri.file(secondRoot) }), true);
      await waitFor(() => (vscode.workspace.workspaceFolders?.length ?? 0) > insertionIndex);
      const selectedFolder = vscode.workspace.workspaceFolders?.[insertionIndex];
      assert.ok(selectedFolder);

      await vscode.commands.executeCommand("kotlinWorksheet.newWorksheet", selectedFolder);

      const created = vscode.workspace.textDocuments.find(
        (document) => path.dirname(document.fileName) === secondRoot && document.fileName.endsWith(".worksheet.kts"),
      );
      assert.ok(created, "Expected the worksheet in the selected workspace folder");
    } finally {
      vscode.workspace.updateWorkspaceFolders(insertionIndex, 1);
      await rm(secondRoot, { recursive: true, force: true });
    }
  });

  (hasKotlinc ? test : test.skip)("Run command produces inline results", async () => {
    const document = await openDocument(
      "val x = 40\nx + 2\nprintln(\"hello\")",
      "run-command.worksheet.kts",
    );
    await configureExecution(document.uri);

    await vscode.commands.executeCommand("kotlinWorksheet.run");

    assert.ok(document.getText().includes("val x = 40 // => 40"));
    assert.ok(document.getText().includes("x + 2 // => 42"));
    assert.strictEqual(vscode.languages.getDiagnostics(document.uri).length, 0);
  }).timeout(30000);

  test("missing Kotlin command leaves the worksheet unchanged", async () => {
    const document = await openDocument("val x = 1", "missing-kotlin.worksheet.kts");
    await updateSetting("kotlinCommand", "definitely-not-a-real-kotlinc-command", document.uri);
    await updateSetting("executionMode", "localKotlinc", document.uri);

    await vscode.commands.executeCommand("kotlinWorksheet.run");

    assert.strictEqual(document.getText(), "val x = 1");
  });

  (hasKotlinc ? test : test.skip)("compiler diagnostics clear after a source edit", async () => {
    const document = await openDocument("val x = missing", "diagnostics.worksheet.kts");
    await configureExecution(document.uri);

    await vscode.commands.executeCommand("kotlinWorksheet.run");
    assert.ok(vscode.languages.getDiagnostics(document.uri).length > 0);

    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((builder) => builder.insert(document.lineAt(0).range.end, "Value"));
    await waitFor(() => vscode.languages.getDiagnostics(document.uri).length === 0);
  }).timeout(30000);

  (hasKotlinc ? test : test.skip)("worksheet execution times out", async () => {
    const document = await openDocument("while (true) {}", "timeout.worksheet.kts");
    await configureExecution(document.uri);
    await updateSetting("timeoutMs", 1000, document.uri);

    await vscode.commands.executeCommand("kotlinWorksheet.run");

    assert.strictEqual(document.getText(), "while (true) {}");
  }).timeout(20000);

  (hasKotlinc ? test : test.skip)("active worksheet execution can be cancelled", async () => {
    const document = await openDocument("while (true) {}", "cancel.worksheet.kts");
    await configureExecution(document.uri);

    const run = vscode.commands.executeCommand("kotlinWorksheet.run");
    await sleep(500);
    await vscode.commands.executeCommand("kotlinWorksheet.cancelActiveRun");
    await run;

    assert.strictEqual(document.getText(), "while (true) {}");
  }).timeout(20000);

  (hasKotlinc ? test : test.skip)("run-on-save evaluates once without duplicate results", async () => {
    const document = await openDocument("val x = 21\nx * 2", "run-on-save.worksheet.kts");
    await configureExecution(document.uri);
    await updateSetting("runOnSave", true, document.uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((builder) => builder.insert(document.lineAt(1).range.end, " "));

    await document.save();
    await waitFor(() => document.getText().includes("// => 42"), 20000);
    const evaluatedText = document.getText();
    await sleep(1500);

    assert.strictEqual(document.getText(), evaluatedText);
    assert.strictEqual((evaluatedText.match(/\/\/ =>/g) ?? []).length, 2);
  }).timeout(30000);

  (hasKotlinc ? test : test.skip)("decoration mode leaves source unchanged and Clear Results is safe", async () => {
    const document = await openDocument("val x = 40\nx + 2", "decorations.worksheet.kts");
    await configureExecution(document.uri);
    await updateSetting("renderMode", "decorations", document.uri);

    await vscode.commands.executeCommand("kotlinWorksheet.run");
    assert.strictEqual(document.getText(), "val x = 40\nx + 2");

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("kotlinWorksheet.clearResults");
    assert.strictEqual(document.getText(), "val x = 40\nx + 2");
    assert.strictEqual(vscode.languages.getDiagnostics(document.uri).length, 0);
  }).timeout(30000);
});

async function configureExecution(resource: vscode.Uri): Promise<void> {
  await updateSetting("kotlinCommand", kotlincPath, resource);
  await updateSetting("executionMode", "localKotlinc", resource);
  await updateSetting("renderMode", "inlineComments", resource);
  await updateSetting("timeoutMs", 10000, resource);
}

async function updateSetting(key: string, value: unknown, resource?: vscode.Uri): Promise<void> {
  await vscode.workspace
    .getConfiguration("kotlinWorksheet", resource)
    .update(key, value, vscode.ConfigurationTarget.Workspace);
}

async function resetSettings(): Promise<void> {
  await updateSetting("kotlinCommand", "kotlinc");
  await updateSetting("executionMode", "auto");
  await updateSetting("renderMode", "inlineComments");
  await updateSetting("runOnSave", false);
  await updateSetting("timeoutMs", 10000);
}

function resolveCommand(command: string): string {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/, 1)[0] : "";
}
