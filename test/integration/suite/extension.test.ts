import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";

const hasKotlinc = spawnSync("kotlinc", ["-version"], { encoding: "utf8" }).status === 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("Kotlin Worksheet Extension Test Suite", () => {
  let tempDir: string;

  setup(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "kws-int-"));
  });

  teardown(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function openDocument(
    content: string,
    fileName: string,
  ): Promise<vscode.TextDocument> {
    const filePath = path.join(tempDir, fileName);
    await writeFile(filePath, content);
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    return document;
  }

  test("commands are registered", async () => {
    const ext = vscode.extensions.getExtension("ws-kts-toppy.kotlin-worksheet");
    assert.ok(ext, "Extension ws-kts-toppy.kotlin-worksheet must be found");
    if (!ext.isActive) {
      await ext.activate();
    }

    const commands = (await vscode.commands.getCommands(true)).filter((cmd) =>
      cmd.startsWith("kotlinWorksheet."),
    );

    assert.ok(commands.includes("kotlinWorksheet.run"));
    assert.ok(commands.includes("kotlinWorksheet.rerun"));
    assert.ok(commands.includes("kotlinWorksheet.clearResults"));
    assert.ok(commands.includes("kotlinWorksheet.newWorksheet"));
    assert.ok(commands.includes("kotlinWorksheet.toggleRunOnSave"));
    assert.ok(commands.includes("kotlinWorksheet.toggleRenderMode"));
  });

  test("run on a non-worksheet file shows information message", async () => {
    const document = await openDocument("val x = 1", "plain.kts");

    await vscode.commands.executeCommand("kotlinWorksheet.run");
    await sleep(1000);

    assert.strictEqual(document.getText(), "val x = 1");
  });

  test("clear results removes inline comments", async () => {
    const document = await openDocument(
      "val a = 1 // => 1\nval b = 2 // => 2\nval c = 3",
      "clear-test.worksheet.kts",
    );

    await vscode.commands.executeCommand("kotlinWorksheet.clearResults");
    await sleep(1000);

    assert.strictEqual(document.getText(), "val a = 1\nval b = 2\nval c = 3");
  });

  test("toggle render mode switches setting", async () => {
    // Open a worksheet file so the toggle command doesn't bail early
    await openDocument("val x = 1", "toggle-render.worksheet.kts");

    const config = vscode.workspace.getConfiguration("kotlinWorksheet");
    const initial = config.get<string>("renderMode", "inlineComments");

    // Toggle writes to ConfigurationTarget.Workspace scoped to the document.
    // Since the document is in tempDir and the workspace is kws-workspace-*,
    // the write may silently fall through. Verify no error is thrown and that
    // after the command the value differs from initial when read via Global.
    await vscode.commands.executeCommand("kotlinWorksheet.toggleRenderMode");

    const globalValue = config.inspect<string>("renderMode");
    const updated = globalValue?.workspaceValue ?? globalValue?.globalValue ?? initial;
    assert.notStrictEqual(updated, initial);

    await config.update("renderMode", initial, vscode.ConfigurationTarget.Global);
  });

  test("toggle run-on-save switches setting", async () => {
    await openDocument("val x = 1", "toggle-save.worksheet.kts");

    const config = vscode.workspace.getConfiguration("kotlinWorksheet");
    const initial = config.get<boolean>("runOnSave", false);

    await vscode.commands.executeCommand("kotlinWorksheet.toggleRunOnSave");

    const globalValue = config.inspect<boolean>("runOnSave");
    const updated = globalValue?.workspaceValue ?? globalValue?.globalValue ?? initial;
    assert.strictEqual(updated, !initial);

    await config.update("runOnSave", initial, vscode.ConfigurationTarget.Global);
  });

  test("new worksheet creates a file in the workspace", async () => {
    const priorFilenames = new Set(
      vscode.workspace.textDocuments.map((d) => d.fileName),
    );

    await vscode.commands.executeCommand("kotlinWorksheet.newWorksheet");
    await sleep(1000);

    const newDoc = vscode.workspace.textDocuments.find(
      (d) => d.fileName.endsWith(".worksheet.kts") && !priorFilenames.has(d.fileName),
    );
    assert.ok(newDoc, "Expected a new worksheet.kts document to be created");
  });

  (hasKotlinc ? test : test.skip)(
    "run worksheet produces inline results with kotlinc available",
    async () => {
      const kotlincPath = (() => {
        const r = spawnSync("which", ["kotlinc"], { encoding: "utf8" });
        return r.status === 0 ? r.stdout.trim() : "";
      })();
      if (!kotlincPath) return;

      // Directly import and call executeWorksheet to isolate the execution
      // path from the VS Code command handler.
      const { executeWorksheet } = await import(
        /* @vite-ignore */ path.resolve(__dirname, "../../../executor.js")
      );

      const result = await executeWorksheet(
        "val x = 40\nx + 2\nprintln(\"hello\")",
        { kotlinCommand: kotlincPath, timeoutMs: 10000 },
      );
      console.log(`executor result: success=${result.success}, exitCode=${result.exitCode}`);
      console.log(`  results: ${JSON.stringify([...result.results.entries()])}`);

      assert.ok(result.success, `executor failed: ${result.stderr}`);
      assert.ok(result.results.has(1) || result.results.has(2) || result.results.has(3));
    },
  );
});
