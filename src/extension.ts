import * as vscode from "vscode";
import { executeWorksheet } from "./executor.js";
import {
  detectExecutionMode,
  locateGradleProjectRoot,
  resolveGradleClasspath,
} from "./gradle.js";
import {
  WORKSHEET_SUFFIX,
  applyWorksheetResults,
  formatWorksheetResult,
  isWorksheetPath,
  stripResultComments,
} from "./worksheet.js";
import path from "node:path";

const running = new Set<string>();
const suppressSaveRun = new Set<string>();
const decorationByDocument = new Map<string, vscode.TextEditorDecorationType>();

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Kotlin Worksheet");
  const diagnostics = vscode.languages.createDiagnosticCollection("kotlinWorksheet");
  const runOnSaveStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  runOnSaveStatus.command = "kotlinWorksheet.toggleRunOnSave";
  const resultDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1ch",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
    },
  });

  const updateStatus = () => updateRunOnSaveStatus(runOnSaveStatus);

  context.subscriptions.push(output, diagnostics, runOnSaveStatus, resultDecoration);
  context.subscriptions.push(
    vscode.commands.registerCommand("kotlinWorksheet.run", () => runActiveWorksheet(output, diagnostics, resultDecoration, false)),
    vscode.commands.registerCommand("kotlinWorksheet.rerun", () => runActiveWorksheet(output, diagnostics, resultDecoration, false)),
    vscode.commands.registerCommand("kotlinWorksheet.clearResults", () => clearActiveWorksheet(resultDecoration)),
    vscode.commands.registerCommand("kotlinWorksheet.newWorksheet", newWorksheet),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRunOnSave", toggleRunOnSave),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRenderMode", toggleRenderMode),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("kotlinWorksheet.runOnSave")) {
        updateStatus();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const uri = document.uri.toString();
      if (suppressSaveRun.has(uri)) {
        return;
      }

      if (!isWorksheetPath(document.fileName)) {
        return;
      }

      const config = vscode.workspace.getConfiguration("kotlinWorksheet", document.uri);
      if (!config.get<boolean>("runOnSave", true)) {
        return;
      }

      void runWorksheetDocument(document, output, diagnostics, resultDecoration, true);
    }),
  );

  updateStatus();
}

export function deactivate(): void {
  running.clear();
  suppressSaveRun.clear();
}

async function runActiveWorksheet(
  output: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
  saveAfterEdit: boolean,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("Open a Kotlin worksheet file first.");
    return;
  }

  await runWorksheetDocument(editor.document, output, diagnostics, resultDecoration, saveAfterEdit);
}

async function runWorksheetDocument(
  document: vscode.TextDocument,
  output: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
  saveAfterEdit: boolean,
): Promise<void> {
  if (!isWorksheetPath(document.fileName)) {
    void vscode.window.showInformationMessage(`Kotlin worksheets must end with ${WORKSHEET_SUFFIX}.`);
    return;
  }

  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage("Kotlin worksheet execution is disabled until this workspace is trusted.");
    return;
  }

  const uri = document.uri.toString();
  if (running.has(uri)) {
    return;
  }

  running.add(uri);
  diagnostics.delete(document.uri);

  try {
    const config = vscode.workspace.getConfiguration("kotlinWorksheet", document.uri);
    const kotlinCommand = config.get<string>("kotlinCommand", "kotlinc");
    const timeoutMs = config.get<number>("timeoutMs", 10000);
    const maxResultLength = config.get<number>("maxResultLength", 500);
    const executionMode = config.get<"auto" | "localKotlinc" | "gradleClasspath">("executionMode", "auto");
    const source = stripResultComments(document.getText());

    output.clear();
    output.appendLine(`Running ${document.fileName}`);
    output.appendLine(`Command: ${kotlinCommand} -script <worksheet>`);

    const execution = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Kotlin worksheet",
        cancellable: true,
      },
      async (_progress, token) => {
        const abortController = new AbortController();
        const subscription = token.onCancellationRequested(() => abortController.abort());

        try {
          const documentDir = path.dirname(document.fileName);
          const resolvedMode = await detectExecutionMode(documentDir, executionMode);
          let classpath: string[] = [];

          if (resolvedMode === "gradleClasspath") {
            const gradleRoot = await locateGradleProjectRoot(documentDir);
            if (gradleRoot) {
              const gradleResolution = await resolveGradleClasspath(gradleRoot, {
                timeoutMs,
                cancellationSignal: abortController.signal,
              });

              if (gradleResolution.success && gradleResolution.classpath.length > 0) {
                classpath = gradleResolution.classpath;
                output.appendLine(`Gradle classpath resolved from ${gradleRoot}`);
              } else if (executionMode === "gradleClasspath") {
                throw new Error(
                  gradleResolution.startError
                    ?? gradleResolution.stderr
                    ?? "Unable to resolve Gradle classpath.",
                );
              }
              if (executionMode === "gradleClasspath" && classpath.length === 0) {
                throw new Error("Gradle project was found, but no classpath entries were resolved.");
              }
            } else if (executionMode === "gradleClasspath") {
              throw new Error("No Gradle project was found for this worksheet.");
            }
          }

          return executeWorksheet(source, {
            kotlinCommand,
            timeoutMs,
            cancellationSignal: abortController.signal,
            classpath,
          });
        } finally {
          subscription.dispose();
        }
      },
    );

    if (execution.stdout.trim()) {
      output.appendLine("");
      output.appendLine("stdout:");
      output.appendLine(execution.stdout.trimEnd());
    }

    if (execution.stderr.trim()) {
      output.appendLine("");
      output.appendLine("stderr:");
      output.appendLine(execution.stderr.trimEnd());
    }

    if (execution.timedOut) {
      output.appendLine("");
      output.appendLine(`Worksheet timed out after ${timeoutMs} ms.`);
      void vscode.window.showErrorMessage(`Kotlin worksheet timed out after ${timeoutMs} ms.`);
      return;
    }

    if (execution.cancelled) {
      output.appendLine("");
      output.appendLine("Worksheet execution cancelled.");
      void vscode.window.setStatusBarMessage("Kotlin worksheet cancelled", 2500);
      return;
    }

    if (execution.startError) {
      output.show(true);
      void vscode.window.showErrorMessage(
        `Unable to start Kotlin command '${kotlinCommand}'. Check kotlinWorksheet.kotlinCommand.`,
      );
      return;
    }

    setDiagnostics(document, diagnostics, execution.diagnostics);

    if (!execution.success) {
      output.show(true);
      void vscode.window.showErrorMessage("Kotlin worksheet failed. See the Kotlin Worksheet output channel.");
      return;
    }

    const renderMode = config.get<"inlineComments" | "decorations">("renderMode", "inlineComments");
    if (renderMode === "decorations") {
      const cleanedText = source;
      if (cleanedText !== document.getText()) {
        await replaceDocumentText(document, cleanedText);
      }
      applyWorksheetDecorations(document, execution.results, resultDecoration, maxResultLength);
    } else {
      clearWorksheetDecorations(document, resultDecoration);
      const updatedText = applyWorksheetResults(source, execution.results, { maxResultLength });
      if (updatedText !== document.getText()) {
        await replaceDocumentText(document, updatedText);
      }
    }

    if (saveAfterEdit && document.isDirty) {
      suppressSaveRun.add(uri);
      try {
        await document.save();
      } finally {
        suppressSaveRun.delete(uri);
      }
    }

    void vscode.window.setStatusBarMessage("Kotlin worksheet evaluated", 2500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine("");
    output.appendLine(message);
    output.show(true);
    void vscode.window.showErrorMessage(`Kotlin worksheet failed: ${message}`);
  } finally {
    running.delete(uri);
  }
}

async function clearActiveWorksheet(resultDecoration: vscode.TextEditorDecorationType): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("Open a Kotlin worksheet file first.");
    return;
  }

  if (!isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Kotlin worksheets must end with ${WORKSHEET_SUFFIX}.`);
    return;
  }

  const cleaned = stripResultComments(editor.document.getText());
  if (cleaned !== editor.document.getText()) {
    await replaceDocumentText(editor.document, cleaned);
  }
  clearWorksheetDecorations(editor.document, resultDecoration);
}

async function toggleRunOnSave(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX} file to toggle Kotlin worksheet auto-run.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("kotlinWorksheet", editor.document.uri);
  const current = config.get<boolean>("runOnSave", false);
  await config.update("runOnSave", !current, vscode.ConfigurationTarget.Workspace);
  void vscode.window.setStatusBarMessage(`Kotlin worksheet auto-run ${!current ? "enabled" : "disabled"}`, 2500);
}

async function toggleRenderMode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX} file to toggle worksheet render mode.`);
    return;
  }

  const config = vscode.workspace.getConfiguration("kotlinWorksheet", editor.document.uri);
  const current = config.get<"inlineComments" | "decorations">("renderMode", "inlineComments");
  const next = current === "inlineComments" ? "decorations" : "inlineComments";
  await config.update("renderMode", next, vscode.ConfigurationTarget.Workspace);
  if (next === "inlineComments") {
    clearWorksheetDecorations(editor.document);
  }
  void vscode.window.setStatusBarMessage(`Kotlin worksheet render mode: ${next}`, 2500);
}

async function newWorksheet(): Promise<void> {
  const content = [
    "val language = \"Kotlin\"",
    "language.uppercase()",
    "",
    "val answer = 40 + 2",
    "answer",
    "",
    "println(\"worksheets run top to bottom\")",
    "",
  ].join("\n");

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    const document = await vscode.workspace.openTextDocument({ language: "kotlin", content });
    await vscode.window.showTextDocument(document);
    void vscode.window.showInformationMessage(`Save this file with the ${WORKSHEET_SUFFIX} suffix to run it.`);
    return;
  }

  const uri = await nextWorksheetUri(workspaceFolder.uri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

function updateRunOnSaveStatus(status: vscode.StatusBarItem): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    status.hide();
    return;
  }

  const enabled = vscode.workspace
    .getConfiguration("kotlinWorksheet", editor.document.uri)
    .get<boolean>("runOnSave", false);
  status.text = enabled ? "$(check) Kotlin WS Auto" : "$(circle-slash) Kotlin WS Manual";
  status.tooltip = enabled
    ? "Kotlin Worksheet: auto-run on save is enabled. Click to disable."
    : "Kotlin Worksheet: manual run mode is enabled. Click to auto-run on save.";
  status.show();
}

async function nextWorksheetUri(folderUri: vscode.Uri): Promise<vscode.Uri> {
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? "worksheet.worksheet.kts" : `worksheet-${index}.worksheet.kts`;
    const uri = vscode.Uri.joinPath(folderUri, name);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return uri;
    }
  }

  throw new Error("Unable to find an available worksheet file name.");
}

async function replaceDocumentText(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const lastLine = document.lineAt(document.lineCount - 1);
  const range = new vscode.Range(new vscode.Position(0, 0), lastLine.rangeIncludingLineBreak.end);
  edit.replace(document.uri, range, text);

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error("Unable to update worksheet document.");
  }
}

function setDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  diagnostics: Array<{ sourceLine: number; sourceColumn: number; severity: "error" | "warning"; message: string }>,
): void {
  const vscodeDiagnostics = diagnostics.map((diagnostic) => {
    const line = Math.max(0, Math.min(document.lineCount - 1, diagnostic.sourceLine - 1));
    const character = Math.max(0, diagnostic.sourceColumn - 1);
    const range = new vscode.Range(line, character, line, character + 1);
    const item = new vscode.Diagnostic(
      range,
      diagnostic.message,
      diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    item.source = "Kotlin Worksheet";
    return item;
  });

  collection.set(document.uri, vscodeDiagnostics);
}

function applyWorksheetDecorations(
  document: vscode.TextDocument,
  results: Map<number, string>,
  decoration: vscode.TextEditorDecorationType,
  maxResultLength: number,
): void {
  const options = Array.from(results.entries())
    .filter(([line, result]) => line > 0 && Boolean(result))
    .map(([line, result]) => {
      const textLine = document.lineAt(line - 1);
      return {
        range: new vscode.Range(line - 1, textLine.range.end.character, line - 1, textLine.range.end.character),
        renderOptions: {
          after: {
            contentText: ` // => ${formatWorksheetResult(result, maxResultLength)}`,
          },
        },
      };
    });

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === document.uri.toString()) {
      editor.setDecorations(decoration, options);
      decorationByDocument.set(document.uri.toString(), decoration);
    }
  }
}

function clearWorksheetDecorations(
  document: vscode.TextDocument,
  decoration?: vscode.TextEditorDecorationType,
): void {
  const docKey = document.uri.toString();
  const activeDecoration = decoration ?? decorationByDocument.get(docKey);
  if (!activeDecoration) {
    return;
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === docKey) {
      editor.setDecorations(activeDecoration, []);
    }
  }

  decorationByDocument.delete(docKey);
}
