import * as vscode from "vscode";
import { executeWorksheet } from "./executor.js";
import { checkEnvironment, type EnvironmentCheckResult } from "./environment.js";
import {
  describeGradleFailure,
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
import { WorksheetRunRegistry } from "./run-state.js";
import { buildWorksheetStatus } from "./status.js";
import { chooseWorkspaceFolder } from "./workspace-selection.js";
import path from "node:path";

const worksheetRuns = new WorksheetRunRegistry();
const suppressSaveRun = new Set<string>();
const decorationOptionsByDocument = new Map<string, vscode.DecorationOptions[]>();
const shownGradleFallbacks = new Set<string>();
let nextRunId = 1;

type RecoveryAction =
  | "Open Output"
  | "Open Settings"
  | "Show Problems"
  | "Show Setup Guide"
  | "Manage Workspace Trust"
  | "Use Local Kotlin";

class GradleResolutionError extends Error {}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Kotlin Worksheet", { log: true });
  const diagnostics = vscode.languages.createDiagnosticCollection("kotlinWorksheet");
  const runOnSaveStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const resultDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1ch",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
    },
  });

  const updateStatus = () => updateWorksheetStatus(runOnSaveStatus);
  const disposeRunStateListener = worksheetRuns.onDidChange((uri) => {
    if (vscode.window.activeTextEditor?.document.uri.toString() === uri) {
      updateStatus();
    }
  });

  context.subscriptions.push(output, diagnostics, runOnSaveStatus, resultDecoration, { dispose: disposeRunStateListener });
  context.subscriptions.push(
    vscode.commands.registerCommand("kotlinWorksheet.run", () => runActiveWorksheet(output, diagnostics, resultDecoration, false)),
    vscode.commands.registerCommand("kotlinWorksheet.clearResults", () => clearActiveWorksheet(resultDecoration, diagnostics)),
    vscode.commands.registerCommand("kotlinWorksheet.newWorksheet", newWorksheet),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRunOnSave", toggleRunOnSave),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRenderMode", () => toggleRenderMode(resultDecoration)),
    vscode.commands.registerCommand("kotlinWorksheet.openSetupGuide", () => openSetupGuide(context.extensionUri)),
    vscode.commands.registerCommand("kotlinWorksheet.showOutput", () => output.show(true)),
    vscode.commands.registerCommand("kotlinWorksheet.checkEnvironment", () => checkWorksheetEnvironment(output)),
    vscode.commands.registerCommand("kotlinWorksheet.cancelActiveRun", cancelActiveRun),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const options = decorationOptionsByDocument.get(editor.document.uri.toString());
        if (options) {
          editor.setDecorations(resultDecoration, options);
        }
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0 || !isWorksheetPath(event.document.fileName)) {
        return;
      }
      diagnostics.delete(event.document.uri);
      clearWorksheetDecorations(event.document, resultDecoration);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      decorationOptionsByDocument.delete(document.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("kotlinWorksheet.runOnSave")
        || event.affectsConfiguration("kotlinWorksheet.executionMode")
      ) {
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
      if (!config.get<boolean>("runOnSave", false)) {
        return;
      }

      void runWorksheetDocument(document, output, diagnostics, resultDecoration, true);
    }),
  );

  updateStatus();
}

export function deactivate(): void {
  worksheetRuns.dispose();
  suppressSaveRun.clear();
  shownGradleFallbacks.clear();
}

async function runActiveWorksheet(
  output: vscode.LogOutputChannel,
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
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
  saveAfterEdit: boolean,
): Promise<void> {
  if (!isWorksheetPath(document.fileName)) {
    void vscode.window.showInformationMessage(`Kotlin worksheets must end with ${WORKSHEET_SUFFIX}.`);
    return;
  }

  if (!vscode.workspace.isTrusted) {
    showWarningWithRecovery(
      output,
      "Kotlin worksheet execution is disabled until this workspace is trusted.",
      ["Manage Workspace Trust"],
      document.uri,
    );
    return;
  }

  const uri = document.uri.toString();
  const run = worksheetRuns.begin(uri);
  if (!run) {
    if (saveAfterEdit) {
      return;
    }

    const action = await vscode.window.showInformationMessage(
      "This Kotlin worksheet is already running.",
      "Cancel Run",
    );
    if (action === "Cancel Run") {
      worksheetRuns.cancel(uri);
    }
    return;
  }

  const runId = nextRunId;
  nextRunId += 1;
  const logPrefix = `[run ${runId}]`;
  diagnostics.delete(document.uri);

  try {
    const config = vscode.workspace.getConfiguration("kotlinWorksheet", document.uri);
    const kotlinCommand = config.get<string>("kotlinCommand", "kotlinc");
    const timeoutMs = config.get<number>("timeoutMs", 10000);
    const maxResultLength = config.get<number>("maxResultLength", 500);
    const executionMode = config.get<"auto" | "localKotlinc" | "gradleClasspath">("executionMode", "auto");
    let source = "";

    output.info(`${logPrefix} ----- Kotlin Worksheet run -----`);
    output.info(`${logPrefix} Worksheet: ${document.fileName}`);
    output.info(`${logPrefix} Requested execution mode: ${executionMode}`);

    const execution = await vscode.window.withProgress(
      {
        location: saveAfterEdit ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification,
        title: saveAfterEdit ? "Kotlin Worksheet" : "Running Kotlin worksheet",
        cancellable: !saveAfterEdit,
      },
      async (progress, token) => {
        progress.report({ message: "Preparing worksheet" });
        source = stripResultComments(document.getText());
        progress.report({ message: "Detecting execution mode" });
        worksheetRuns.transition(uri, "resolving");
        const subscription = token.onCancellationRequested(() => worksheetRuns.cancel(uri));

        try {
          const documentDir = path.dirname(document.fileName);
          const resolvedMode = await detectExecutionMode(documentDir, executionMode);
          worksheetRuns.setExecutionMode(uri, resolvedMode);
          output.info(`${logPrefix} Resolved execution mode: ${resolvedMode}`);
          let classpath: string[] = [];

          if (resolvedMode === "gradleClasspath") {
            progress.report({ message: "Resolving Gradle classpath" });
            const gradleRoot = await locateGradleProjectRoot(documentDir);
            if (gradleRoot) {
              const gradleResolution = await resolveGradleClasspath(gradleRoot, {
                timeoutMs,
                cancellationSignal: run.cancellationSignal,
              });

              if (run.cancellationSignal.aborted) {
                throw new Error("Worksheet execution cancelled.");
              }

              if (gradleResolution.success && gradleResolution.classpath.length > 0) {
                classpath = gradleResolution.classpath;
                output.info(`${logPrefix} Gradle classpath: ${classpath.length} entries from ${gradleRoot}`);
                output.debug(`${logPrefix} Gradle classpath entries: ${classpath.join(path.delimiter)}`);
              } else if (executionMode === "gradleClasspath") {
                throw new GradleResolutionError(describeGradleFailure(gradleResolution));
              } else {
                const reason = describeGradleFailure(gradleResolution);
                worksheetRuns.setExecutionMode(uri, "localKotlinc");
                output.warn(
                  `${logPrefix} Gradle classpath resolution failed (${reason}); continuing with local Kotlin.`,
                );
                showGradleFallbackWarning(output, document.uri, gradleRoot, reason);
              }
            } else if (executionMode === "gradleClasspath") {
              throw new GradleResolutionError("No Gradle project was found for this worksheet.");
            } else {
              worksheetRuns.setExecutionMode(uri, "localKotlinc");
              output.warn(`${logPrefix} Gradle project was no longer available; continuing with local Kotlin.`);
              showGradleFallbackWarning(
                output,
                document.uri,
                documentDir,
                "the Gradle project was no longer available",
              );
            }
          }

          const classpathArgument = classpath.length > 0 ? ` -classpath <${classpath.length} entries>` : "";
          output.info(`${logPrefix} Invocation: ${kotlinCommand}${classpathArgument} -script <worksheet>`);
          progress.report({ message: "Running Kotlin" });
          worksheetRuns.transition(uri, "running");
          const execution = await executeWorksheet(source, {
            kotlinCommand,
            timeoutMs,
            cancellationSignal: run.cancellationSignal,
            classpath,
          });

          if (execution.success) {
            progress.report({ message: "Applying results" });
            worksheetRuns.transition(uri, "applying");
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
          }

          return execution;
        } finally {
          subscription.dispose();
        }
      },
    );

    if (execution.stdout.trim()) {
      output.info(`${logPrefix} stdout:\n${execution.stdout.trimEnd()}`);
    }

    if (execution.stderr.trim()) {
      output.error(`${logPrefix} stderr:\n${execution.stderr.trimEnd()}`);
    }

    if (execution.timedOut) {
      output.error(`${logPrefix} Worksheet timed out after ${timeoutMs} ms.`);
      showErrorWithRecovery(
        output,
        `Kotlin worksheet timed out after ${timeoutMs} ms.`,
        ["Open Settings", "Open Output"],
        document.uri,
      );
      finishWorksheetRun(output, uri, logPrefix, "timedOut", execution.exitCode);
      return;
    }

    if (execution.cancelled) {
      output.info(`${logPrefix} Worksheet execution cancelled.`);
      void vscode.window.setStatusBarMessage("Kotlin worksheet cancelled", 2500);
      finishWorksheetRun(output, uri, logPrefix, "cancelled", execution.exitCode);
      return;
    }

    if (execution.startError) {
      output.error(`${logPrefix} ${execution.startError}`);
      showErrorWithRecovery(
        output,
        `Unable to start Kotlin command '${kotlinCommand}'. Check kotlinWorksheet.kotlinCommand.`,
        ["Open Settings", "Show Setup Guide", "Open Output"],
        document.uri,
      );
      finishWorksheetRun(output, uri, logPrefix, "failed", execution.exitCode);
      return;
    }

    setDiagnostics(document, diagnostics, execution.diagnostics);

    if (!execution.success) {
      showErrorWithRecovery(
        output,
        "Kotlin worksheet failed. Check Problems for source errors or open the log for details.",
        ["Show Problems", "Open Output"],
        document.uri,
      );
      finishWorksheetRun(output, uri, logPrefix, "failed", execution.exitCode);
      return;
    }

    void vscode.window.setStatusBarMessage("Kotlin worksheet evaluated", 2500);
    finishWorksheetRun(output, uri, logPrefix, "succeeded", execution.exitCode);
  } catch (error) {
    if (run.cancellationSignal.aborted) {
      output.info(`${logPrefix} Worksheet execution cancelled.`);
      void vscode.window.setStatusBarMessage("Kotlin worksheet cancelled", 2500);
      finishWorksheetRun(output, uri, logPrefix, "cancelled");
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    output.error(`${logPrefix} ${message}`);
    if (error instanceof GradleResolutionError) {
      showErrorWithRecovery(
        output,
        `Unable to resolve the Gradle classpath: ${message}`,
        ["Open Output", "Use Local Kotlin", "Open Settings"],
        document.uri,
      );
    } else {
      showErrorWithRecovery(
        output,
        `Kotlin worksheet failed: ${message}`,
        ["Open Output"],
        document.uri,
      );
    }
    finishWorksheetRun(output, uri, logPrefix, "failed");
  } finally {
    if (worksheetRuns.isRunning(uri)) {
      finishWorksheetRun(output, uri, logPrefix, "failed");
    }
  }
}

function showErrorWithRecovery(
  output: vscode.LogOutputChannel,
  message: string,
  actions: RecoveryAction[],
  resource?: vscode.Uri,
): void {
  void showRecoveryMessage("error", output, message, actions, resource);
}

function showWarningWithRecovery(
  output: vscode.LogOutputChannel,
  message: string,
  actions: RecoveryAction[],
  resource?: vscode.Uri,
): void {
  void showRecoveryMessage("warning", output, message, actions, resource);
}

async function showRecoveryMessage(
  severity: "error" | "warning",
  output: vscode.LogOutputChannel,
  message: string,
  actions: RecoveryAction[],
  resource?: vscode.Uri,
): Promise<void> {
  const selected = severity === "error"
    ? await vscode.window.showErrorMessage(message, ...actions)
    : await vscode.window.showWarningMessage(message, ...actions);
  if (!selected) {
    return;
  }

  try {
    switch (selected) {
      case "Open Output":
        output.show(true);
        break;
      case "Open Settings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "kotlinWorksheet");
        break;
      case "Show Problems":
        await vscode.commands.executeCommand("workbench.actions.view.problems");
        break;
      case "Show Setup Guide":
        await vscode.commands.executeCommand("kotlinWorksheet.openSetupGuide");
        break;
      case "Manage Workspace Trust":
        await vscode.commands.executeCommand("workbench.trust.manage");
        break;
      case "Use Local Kotlin":
        await vscode.workspace
          .getConfiguration("kotlinWorksheet", resource)
          .update("executionMode", "localKotlinc", vscode.ConfigurationTarget.Workspace);
        void vscode.window.setStatusBarMessage("Kotlin Worksheet will use local Kotlin", 3000);
        break;
    }
  } catch (error) {
    const actionError = error instanceof Error ? error.message : String(error);
    output.error(`Recovery action '${selected}' failed: ${actionError}`);
    void vscode.window.showErrorMessage(`Unable to complete '${selected}'. See the Kotlin Worksheet log.`);
  }
}

function showGradleFallbackWarning(
  output: vscode.LogOutputChannel,
  resource: vscode.Uri,
  projectKey: string,
  reason: string,
): void {
  if (shownGradleFallbacks.has(projectKey)) {
    return;
  }
  shownGradleFallbacks.add(projectKey);
  showWarningWithRecovery(
    output,
    `Gradle classpath resolution failed (${reason}). This run will continue with local Kotlin.`,
    ["Open Output", "Use Local Kotlin", "Open Settings"],
    resource,
  );
}

async function openSetupGuide(extensionUri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      "ws-kts-toppy.kotlin-worksheet#kotlinWorksheet.gettingStarted",
      false,
    );
  } catch {
    const guideUri = vscode.Uri.joinPath(extensionUri, "docs", "user-guide.md");
    await vscode.commands.executeCommand("markdown.showPreview", guideUri);
  }
}

async function checkWorksheetEnvironment(output: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const workspaceFolder = editor
    ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
    : vscode.workspace.workspaceFolders?.[0];
  const resource = editor?.document.uri ?? workspaceFolder?.uri;
  const documentDir = editor && editor.document.uri.scheme === "file"
    ? path.dirname(editor.document.fileName)
    : workspaceFolder?.uri.fsPath;
  const config = vscode.workspace.getConfiguration("kotlinWorksheet", resource);
  const kotlinCommand = config.get<string>("kotlinCommand", "kotlinc");
  const executionMode = config.get<"auto" | "localKotlinc" | "gradleClasspath">("executionMode", "auto");

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking Kotlin Worksheet environment",
      cancellable: false,
    },
    () => checkEnvironment({
      trusted: vscode.workspace.isTrusted,
      kotlinCommand,
      executionMode,
      documentDir,
    }),
  );

  logEnvironmentCheck(output, result);
  if (!result.trusted) {
    showWarningWithRecovery(
      output,
      "Trust this workspace before checking or running Kotlin commands.",
      ["Manage Workspace Trust"],
      resource,
    );
    return;
  }
  if (result.kotlin.status !== "available") {
    showErrorWithRecovery(
      output,
      `Kotlin is not ready: ${result.kotlin.error ?? "the configured command is unavailable"}`,
      ["Open Settings", "Show Setup Guide", "Open Output"],
      resource,
    );
    return;
  }
  if (result.gradle.required && result.gradle.status !== "available") {
    showErrorWithRecovery(
      output,
      `Gradle classpath mode is not ready: ${result.gradle.error ?? "Gradle is unavailable"}`,
      ["Open Output", "Use Local Kotlin", "Open Settings"],
      resource,
    );
    return;
  }
  if (
    result.executionMode === "auto"
    && result.gradle.projectRoot
    && result.gradle.status === "unavailable"
  ) {
    showWarningWithRecovery(
      output,
      "Kotlin is ready, but Gradle is unavailable. Automatic mode will use local Kotlin.",
      ["Open Output", "Use Local Kotlin", "Open Settings"],
      resource,
    );
    return;
  }

  const gradleSummary = result.gradle.status === "available" ? " Gradle was detected." : "";
  const selected = await vscode.window.showInformationMessage(
    `Kotlin Worksheet is ready. ${result.kotlin.version ?? "Kotlin is available"}.${gradleSummary}`,
    "Open Output",
  );
  if (selected === "Open Output") {
    output.show(true);
  }
}

function logEnvironmentCheck(output: vscode.LogOutputChannel, result: EnvironmentCheckResult): void {
  output.info("[environment] ----- Kotlin Worksheet environment check -----");
  output.info(`[environment] Workspace trusted: ${result.trusted}`);
  output.info(`[environment] Execution mode: ${result.executionMode}`);
  output.info(`[environment] Kotlin command: ${result.kotlin.command}`);
  if (result.kotlin.status === "available") {
    output.info(`[environment] Kotlin: available (${result.kotlin.version ?? "version unavailable"})`);
  } else {
    output.warn(`[environment] Kotlin: ${result.kotlin.status}${result.kotlin.error ? ` (${result.kotlin.error})` : ""}`);
  }
  output.info(`[environment] Gradle project: ${result.gradle.projectRoot ?? "not detected"}`);
  if (result.gradle.status === "available") {
    output.info(`[environment] Gradle: available (${result.gradle.command ?? "command detected"})`);
  } else if (result.gradle.status === "unavailable") {
    output.warn(`[environment] Gradle: unavailable (${result.gradle.error ?? "unknown reason"})`);
  } else {
    output.info("[environment] Gradle: not needed");
  }
  output.info(`[environment] Ready: ${result.ready}`);
}

function cancelActiveRun(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX} file to cancel a worksheet run.`);
    return;
  }

  if (worksheetRuns.cancel(editor.document.uri.toString())) {
    void vscode.window.setStatusBarMessage("Cancelling Kotlin worksheet...", 2500);
  } else {
    void vscode.window.showInformationMessage("This Kotlin worksheet is not running.");
  }
}

function finishWorksheetRun(
  output: vscode.LogOutputChannel,
  uri: string,
  logPrefix: string,
  status: "succeeded" | "failed" | "cancelled" | "timedOut",
  exitCode?: number | null,
): void {
  worksheetRuns.finish(uri, status);
  const durationMs = worksheetRuns.getState(uri).durationMs ?? 0;
  const exitCodeText = exitCode === undefined || exitCode === null ? "unavailable" : String(exitCode);
  const summary = `${logPrefix} Finished: status=${status}, duration=${durationMs} ms, exitCode=${exitCodeText}`;
  if (status === "failed" || status === "timedOut") {
    output.error(summary);
  } else {
    output.info(summary);
  }
}

async function clearActiveWorksheet(
  resultDecoration: vscode.TextEditorDecorationType,
  diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
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
  diagnostics.delete(editor.document.uri);
}

async function toggleRunOnSave(): Promise<boolean | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX} file to toggle Kotlin worksheet auto-run.`);
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("kotlinWorksheet", editor.document.uri);
  const current = config.get<boolean>("runOnSave", false);
  await config.update("runOnSave", !current, vscode.ConfigurationTarget.Workspace);
  void vscode.window.setStatusBarMessage(`Kotlin worksheet auto-run ${!current ? "enabled" : "disabled"}`, 2500);
  return !current;
}

async function toggleRenderMode(
  resultDecoration: vscode.TextEditorDecorationType,
): Promise<"inlineComments" | "decorations" | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX} file to toggle worksheet render mode.`);
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("kotlinWorksheet", editor.document.uri);
  const current = config.get<"inlineComments" | "decorations">("renderMode", "inlineComments");
  const next = current === "inlineComments" ? "decorations" : "inlineComments";
  await config.update("renderMode", next, vscode.ConfigurationTarget.Workspace);
  clearWorksheetDecorations(editor.document, resultDecoration);
  if (next === "decorations") {
    const cleaned = stripResultComments(editor.document.getText());
    if (cleaned !== editor.document.getText()) {
      await replaceDocumentText(editor.document, cleaned);
    }
    void vscode.window.setStatusBarMessage("Kotlin worksheet render mode: decorations", 2500);
  } else {
    void vscode.window.showInformationMessage("Kotlin worksheet results will be written inline on the next run.");
  }
  return next;
}

async function newWorksheet(preselectedFolder?: vscode.WorkspaceFolder): Promise<void> {
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

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    const document = await vscode.workspace.openTextDocument({ language: "kotlin", content });
    await vscode.window.showTextDocument(document);
    void vscode.window.showInformationMessage(`Save this file with the ${WORKSHEET_SUFFIX} suffix to run it.`);
    return;
  }

  const workspaceFolder = preselectedFolder && workspaceFolders.some(
    (folder) => folder.uri.toString() === preselectedFolder.uri.toString(),
  )
    ? preselectedFolder
    : await chooseWorkspaceFolder(
        workspaceFolders,
        () => vscode.window.showWorkspaceFolderPick({ placeHolder: "Choose where to create the Kotlin worksheet" }),
      );
  if (!workspaceFolder) {
    return;
  }

  const uri = await nextWorksheetUri(workspaceFolder.uri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

function updateWorksheetStatus(status: vscode.StatusBarItem): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.commands.executeCommand("setContext", "kotlinWorksheet.active", false);
    status.hide();
    return;
  }

  void vscode.commands.executeCommand("setContext", "kotlinWorksheet.active", true);
  const config = vscode.workspace.getConfiguration("kotlinWorksheet", editor.document.uri);
  const presentation = buildWorksheetStatus({
    state: worksheetRuns.getState(editor.document.uri.toString()),
    runOnSave: config.get<boolean>("runOnSave", false),
    requestedExecutionMode: config.get<"auto" | "localKotlinc" | "gradleClasspath">("executionMode", "auto"),
  });
  status.text = presentation.text;
  status.tooltip = presentation.tooltip;
  status.command = presentation.command;
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
    }
  }
  decorationOptionsByDocument.set(document.uri.toString(), options);
}

function clearWorksheetDecorations(
  document: vscode.TextDocument,
  decoration?: vscode.TextEditorDecorationType,
): void {
  const docKey = document.uri.toString();
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.toString() === docKey) {
      if (decoration) {
        editor.setDecorations(decoration, []);
      }
    }
  }

  decorationOptionsByDocument.delete(docKey);
}
