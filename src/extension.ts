import * as vscode from "vscode";
import { executeWorksheet } from "./executor.js";
import { checkEnvironment, type EnvironmentCheckResult } from "./environment.js";
import { shutdownSharedKotlinDaemon } from "./daemon.js";
import { GradleClasspathCache } from "./gradle-cache.js";
import {
  buildGradleFailureReport,
  locateGradleProjectRoot,
  type ExecutionMode,
  type GradleFailureKind,
} from "./gradle.js";
import {
  buildMavenFailureReport,
  locateMavenProjectRoot,
  type MavenFailureKind,
} from "./maven.js";
import { MavenClasspathCache } from "./maven-cache.js";
import {
  WORKSHEET_SUFFIX,
  WORKSHEET_SUFFIX_DESCRIPTION,
  WORKSHEET_TEMPLATES,
  applyWorksheetResults,
  exportToKotlinFile,
  exportToTestFile,
  formatWorksheetResult,
  findWorksheetRange,
  isWorksheetPath,
  isWorksheetResultTruncated,
  parseWorksheetResults,
  stripResultComments,
  truncateWorksheetSource,
  type WorksheetRange,
} from "./worksheet.js";
import { WorksheetRunRegistry } from "./run-state.js";
import { buildWorksheetStatus } from "./status.js";
import { chooseWorkspaceFolder } from "./workspace-selection.js";
import path from "node:path";

const worksheetRuns = new WorksheetRunRegistry();
const suppressSaveRun = new Set<string>();
const cleaningDocuments = new Set<string>();
const preservingResults = new Set<string>();
const decorationOptionsByDocument = new Map<string, vscode.DecorationOptions[]>();
const decorationResultsByDocument = new Map<string, Map<number, string>>();
const latestWorksheetResultsByDocument = new Map<string, Map<number, string>>();
const shownGradleFallbacks = new Set<string>();
const shownMavenFallbacks = new Set<string>();
const gradleClasspathCache = new GradleClasspathCache();
const mavenClasspathCache = new MavenClasspathCache();
let nextRunId = 1;

type RecoveryAction =
  | "Open Output"
  | "Open Settings"
  | "Show Problems"
  | "Show Setup Guide"
  | "Manage Workspace Trust"
  | "Use Local Kotlin";

class GradleResolutionError extends Error {
  constructor(
    readonly kind: GradleFailureKind,
    message: string,
  ) {
    super(message);
  }
}

class MavenResolutionError extends Error {
  constructor(
    readonly kind: MavenFailureKind,
    message: string,
  ) {
    super(message);
  }
}

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

  const resultProvider = new KotlinWorksheetResultProvider();
  context.subscriptions.push(
    output,
    diagnostics,
    runOnSaveStatus,
    resultDecoration,
    { dispose: disposeRunStateListener },
    vscode.workspace.registerTextDocumentContentProvider("kotlin-worksheet-result", resultProvider),
    vscode.languages.registerHoverProvider({ scheme: "file", language: "kotlin" }, createWorksheetHoverProvider()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("kotlinWorksheet.run", () => runActiveWorksheet(output, diagnostics, resultDecoration, false)),
    vscode.commands.registerCommand("kotlinWorksheet.runSelection", () => runSelection(output, diagnostics, resultDecoration)),
    vscode.commands.registerCommand("kotlinWorksheet.runCurrentBlock", () => runCurrentBlock(output, diagnostics, resultDecoration)),
    vscode.commands.registerCommand("kotlinWorksheet.clearResults", () => clearActiveWorksheet(resultDecoration, diagnostics)),
    vscode.commands.registerCommand("kotlinWorksheet.newWorksheet", newWorksheet),
    vscode.commands.registerCommand("kotlinWorksheet.newWorksheetFromTemplate", newWorksheetFromTemplate),
    vscode.commands.registerCommand("kotlinWorksheet.exportToKotlin", exportToKotlin),
    vscode.commands.registerCommand("kotlinWorksheet.exportToTest", exportToTest),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRunOnSave", toggleRunOnSave),
    vscode.commands.registerCommand("kotlinWorksheet.toggleRenderMode", () => toggleRenderMode(resultDecoration)),
    vscode.commands.registerCommand("kotlinWorksheet.refreshGradleClasspath", () => refreshGradleClasspath(output)),
    vscode.commands.registerCommand("kotlinWorksheet.refreshMavenClasspath", () => refreshMavenClasspath(output)),
    vscode.commands.registerCommand("kotlinWorksheet.restartDaemon", () => restartDaemon(output)),
    vscode.commands.registerCommand("kotlinWorksheet.openSetupGuide", () => openSetupGuide(context.extensionUri)),
    vscode.commands.registerCommand("kotlinWorksheet.showOutput", () => output.show(true)),
    vscode.commands.registerCommand("kotlinWorksheet.checkEnvironment", () => checkWorksheetEnvironment(output)),
    vscode.commands.registerCommand("kotlinWorksheet.cancelActiveRun", cancelActiveRun),
    vscode.commands.registerCommand("kotlinWorksheet.inspectResult", inspectResult),
    vscode.commands.registerCommand("kotlinWorksheet.copyResult", copyResult),
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

      const uri = event.document.uri.toString();
      if (cleaningDocuments.has(uri) || preservingResults.has(uri)) {
        return;
      }

      worksheetRuns.cancel(uri);

      const cleaned = stripResultComments(event.document.getText());
      if (cleaned === event.document.getText()) {
        return;
      }

      cleaningDocuments.add(uri);
      void replaceDocumentText(event.document, cleaned).finally(() => cleaningDocuments.delete(uri));
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      worksheetRuns.cancel(document.uri.toString());
      diagnostics.delete(document.uri);
      decorationOptionsByDocument.delete(document.uri.toString());
      decorationResultsByDocument.delete(document.uri.toString());
      latestWorksheetResultsByDocument.delete(document.uri.toString());
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
  cleaningDocuments.clear();
  preservingResults.clear();
  decorationOptionsByDocument.clear();
  decorationResultsByDocument.clear();
  latestWorksheetResultsByDocument.clear();
  shownGradleFallbacks.clear();
  shownMavenFallbacks.clear();
  gradleClasspathCache.clear();
  mavenClasspathCache.clear();
  void shutdownSharedKotlinDaemon();
}

async function runActiveWorksheet(
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
  saveAfterEdit: boolean,
  resultRange?: WorksheetRange,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("Open a Kotlin worksheet file first.");
    return;
  }

  await runWorksheetDocument(editor.document, output, diagnostics, resultDecoration, saveAfterEdit, resultRange);
}

async function runSelection(
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
    return;
  }
  if (editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("Select worksheet code to run.");
    return;
  }

  const range = findWorksheetRange(
    editor.document.getText(),
    editor.selection.start.line + 1,
    editor.selection.end.line + 1,
  );
  await runWorksheetDocument(editor.document, output, diagnostics, resultDecoration, false, range);
}

async function runCurrentBlock(
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
    return;
  }

  const line = editor.selection.active.line + 1;
  const range = findWorksheetRange(editor.document.getText(), line);
  await runWorksheetDocument(editor.document, output, diagnostics, resultDecoration, false, range);
}

async function runWorksheetDocument(
  document: vscode.TextDocument,
  output: vscode.LogOutputChannel,
  diagnostics: vscode.DiagnosticCollection,
  resultDecoration: vscode.TextEditorDecorationType,
  saveAfterEdit: boolean,
  resultRange?: WorksheetRange,
): Promise<void> {
  if (!isWorksheetPath(document.fileName)) {
    void vscode.window.showInformationMessage(`Kotlin worksheets must end with ${WORKSHEET_SUFFIX_DESCRIPTION}.`);
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
    const executionMode = config.get<ExecutionMode>("executionMode", "auto");
    const gradleClasspathCacheEnabled = config.get<boolean>("gradleClasspathCache.enabled", true);
    let source = "";
    let executionSource = "";
    let previousResults = new Map<number, string>();
    let sourceVersion = document.version;
    const runStartedAt = Date.now();

    const logPhase = (phase: string, startedAt: number) => {
      output.debug(`${logPrefix} ${phase} completed in ${Date.now() - startedAt} ms.`);
    };

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
        let phaseStartedAt = Date.now();
        progress.report({ message: "Preparing worksheet" });
        previousResults = parseWorksheetResults(document.getText());
        if (config.get<"inlineComments" | "decorations">("renderMode", "inlineComments") === "decorations") {
          previousResults = new Map(decorationResultsByDocument.get(uri) ?? []);
        }
        source = stripResultComments(document.getText());
        if (source !== document.getText()) {
          cleaningDocuments.add(uri);
          try {
            await replaceDocumentText(document, source);
          } finally {
            cleaningDocuments.delete(uri);
          }
        }
        sourceVersion = document.version;
        logPhase("Preparation", phaseStartedAt);
        progress.report({ message: "Detecting execution mode" });
        worksheetRuns.transition(uri, "resolving");
        const subscription = token.onCancellationRequested(() => worksheetRuns.cancel(uri));

        try {
          const documentDir = path.dirname(document.fileName);
          phaseStartedAt = Date.now();
          const gradleRoot = executionMode === "localKotlinc" || executionMode === "mavenClasspath"
            ? undefined
            : await locateGradleProjectRoot(documentDir);
          const mavenRoot = executionMode === "localKotlinc" || executionMode === "gradleClasspath" || gradleRoot
            ? undefined
            : await locateMavenProjectRoot(documentDir);
          const resolvedMode = resolveExecutionMode(executionMode, gradleRoot, mavenRoot);
          logPhase("Execution mode detection", phaseStartedAt);
          worksheetRuns.setExecutionMode(uri, resolvedMode);
          output.info(`${logPrefix} Resolved execution mode: ${resolvedMode}`);
          let classpath: string[] = [];

          if (resolvedMode === "gradleClasspath") {
            progress.report({ message: "Resolving Gradle classpath" });
            if (gradleRoot) {
              phaseStartedAt = Date.now();
              const gradleResolution = await gradleClasspathCache.resolve(gradleRoot, {
                timeoutMs,
                cancellationSignal: run.cancellationSignal,
                worksheetDir: documentDir,
                enabled: gradleClasspathCacheEnabled,
              });
              logPhase("Gradle classpath resolution", phaseStartedAt);
              logGradleCacheStatus(output, logPrefix, gradleResolution.cacheStatus);

              if (run.cancellationSignal.aborted) {
                const report = buildGradleFailureReport(logPrefix, {
                  ...gradleResolution,
                  cancelled: true,
                });
                output.warn(report.logMessage);
                throw new Error("Worksheet execution cancelled.");
              }

              if (gradleResolution.success && gradleResolution.classpath.length > 0) {
                classpath = gradleResolution.classpath;
                output.info(`${logPrefix} Gradle classpath: ${classpath.length} entries from ${gradleRoot}`);
                output.debug(`${logPrefix} Gradle classpath entries: ${classpath.join(path.delimiter)}`);
              } else if (executionMode === "gradleClasspath") {
                const report = buildGradleFailureReport(logPrefix, gradleResolution);
                output.warn(report.logMessage);
                throw new GradleResolutionError(report.kind, report.reason);
              } else {
                const report = buildGradleFailureReport(logPrefix, gradleResolution);
                output.warn(report.logMessage);
                worksheetRuns.setExecutionMode(uri, "localKotlinc");
                output.warn(
                  `${logPrefix} Gradle classpath resolution failed (${report.reason}); continuing with local Kotlin.`,
                );
                showGradleFallbackWarning(output, document.uri, gradleRoot, report.reason);
              }
            } else if (executionMode === "gradleClasspath") {
              const report = buildGradleFailureReport(logPrefix, {
                classpath: [],
                stderr: "No Gradle project contains the worksheet directory.",
                timedOut: false,
                cancelled: false,
              });
              output.warn(report.logMessage);
              throw new GradleResolutionError(report.kind, report.reason);
            } else {
              const report = buildGradleFailureReport(logPrefix, {
                classpath: [],
                stderr: "No Gradle project contains the worksheet directory.",
                timedOut: false,
                cancelled: false,
              });
              worksheetRuns.setExecutionMode(uri, "localKotlinc");
              output.warn(report.logMessage);
              output.warn(`${logPrefix} Gradle project was no longer available; continuing with local Kotlin.`);
              showGradleFallbackWarning(
                output,
                document.uri,
                documentDir,
                report.reason,
              );
            }
          } else if (resolvedMode === "mavenClasspath") {
            progress.report({ message: "Resolving Maven classpath" });
            const mavenClasspathCacheEnabled = config.get<boolean>("mavenClasspathCache.enabled", true);
            if (mavenRoot) {
              phaseStartedAt = Date.now();
              const mavenResolution = await mavenClasspathCache.resolve(mavenRoot, {
                timeoutMs,
                cancellationSignal: run.cancellationSignal,
                worksheetDir: documentDir,
                enabled: mavenClasspathCacheEnabled,
              });
              logPhase("Maven classpath resolution", phaseStartedAt);
              logMavenCacheStatus(output, logPrefix, mavenResolution.cacheStatus);

              if (run.cancellationSignal.aborted) {
                const report = buildMavenFailureReport(logPrefix, {
                  ...mavenResolution,
                  cancelled: true,
                });
                output.warn(report.logMessage);
                throw new Error("Worksheet execution cancelled.");
              }

              if (mavenResolution.success && mavenResolution.classpath.length > 0) {
                classpath = mavenResolution.classpath;
                output.info(`${logPrefix} Maven classpath: ${classpath.length} entries from ${mavenRoot}`);
                output.debug(`${logPrefix} Maven classpath entries: ${classpath.join(path.delimiter)}`);
              } else if (executionMode === "mavenClasspath") {
                const report = buildMavenFailureReport(logPrefix, mavenResolution);
                output.warn(report.logMessage);
                throw new MavenResolutionError(report.kind, report.reason);
              } else {
                const report = buildMavenFailureReport(logPrefix, mavenResolution);
                output.warn(report.logMessage);
                worksheetRuns.setExecutionMode(uri, "localKotlinc");
                output.warn(
                  `${logPrefix} Maven classpath resolution failed (${report.reason}); continuing with local Kotlin.`,
                );
                showMavenFallbackWarning(output, document.uri, mavenRoot, report.reason);
              }
            } else if (executionMode === "mavenClasspath") {
              const report = buildMavenFailureReport(logPrefix, {
                classpath: [],
                stderr: "No Maven pom.xml contains the worksheet directory.",
                timedOut: false,
                cancelled: false,
              });
              output.warn(report.logMessage);
              throw new MavenResolutionError(report.kind, report.reason);
            }
          }

          const classpathArgument = classpath.length > 0 ? ` -classpath <${classpath.length} entries>` : "";
          output.info(`${logPrefix} Invocation: ${kotlinCommand}${classpathArgument} -script <worksheet>`);
          progress.report({ message: "Running Kotlin" });
          worksheetRuns.transition(uri, "running");
          executionSource = resultRange ? truncateWorksheetSource(source, resultRange.endLine) : source;
          phaseStartedAt = Date.now();
          const daemonEnabled = config.get<boolean>("daemon.enabled", true);
          const execution = await executeWorksheet(executionSource, {
            kotlinCommand,
            timeoutMs,
            cancellationSignal: run.cancellationSignal,
            classpath,
            resultRange,
            useDaemon: daemonEnabled,
          });
          logPhase("Kotlin execution", phaseStartedAt);

          if (execution.success) {
            const documentIsOpen = vscode.workspace.textDocuments.some(
              (openDocument) => openDocument.uri.toString() === uri,
            );
            if (!documentIsOpen || document.version !== sourceVersion) {
              output.warn(`${logPrefix} Results discarded because the worksheet changed or closed during execution.`);
              return execution;
            }

            progress.report({ message: "Applying results" });
            worksheetRuns.transition(uri, "applying");
            phaseStartedAt = Date.now();
            const renderMode = config.get<"inlineComments" | "decorations">("renderMode", "inlineComments");
            const mergedResults = resultRange
              ? mergeWorksheetResults(previousResults, execution.results, resultRange)
              : execution.results;
            latestWorksheetResultsByDocument.set(uri, new Map(mergedResults));
            if (renderMode === "decorations") {
              const cleanedText = source;
              if (cleanedText !== document.getText()) {
                preservingResults.add(uri);
                try {
                  await replaceDocumentText(document, cleanedText);
                } finally {
                  preservingResults.delete(uri);
                }
              }
              applyWorksheetDecorations(document, mergedResults, resultDecoration, maxResultLength);
            } else {
              clearWorksheetDecorations(document, resultDecoration);
              const updatedText = applyWorksheetResults(source, mergedResults, { maxResultLength });
              if (updatedText !== document.getText()) {
                preservingResults.add(uri);
                try {
                  await replaceDocumentText(document, updatedText);
                } finally {
                  preservingResults.delete(uri);
                }
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
            logPhase("Result application", phaseStartedAt);
          }

          output.debug(`${logPrefix} Total execution pipeline completed in ${Date.now() - runStartedAt} ms.`);
          return execution;
        } finally {
          subscription.dispose();
        }
      },
    );

    const truncatedResults = Array.from(execution.results.entries())
      .filter(([, result]) => isWorksheetResultTruncated(result, maxResultLength))
      .map(([line]) => line);
    if (truncatedResults.length > 0) {
      output.warn(
        `${logPrefix} ${truncatedResults.length} result(s) exceeded ${maxResultLength} characters and were truncated in the editor (source lines: ${truncatedResults.join(", ")}). Full output is available in this log.`,
      );
    }

    if (execution.runtimeOutput.trim()) {
      output.info(`${logPrefix} Runtime Output:\n${execution.runtimeOutput.trimEnd()}`);
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

function showMavenFallbackWarning(
  output: vscode.LogOutputChannel,
  resource: vscode.Uri,
  projectKey: string,
  reason: string,
): void {
  if (shownMavenFallbacks.has(projectKey)) {
    return;
  }
  shownMavenFallbacks.add(projectKey);
  showWarningWithRecovery(
    output,
    `Maven classpath resolution failed (${reason}). This run will continue with local Kotlin.`,
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
  const executionMode = config.get<ExecutionMode>("executionMode", "auto");

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
  if (result.maven?.required && result.maven.status !== "available") {
    showErrorWithRecovery(
      output,
      `Maven classpath mode is not ready: ${result.maven.error ?? "Maven is unavailable"}`,
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
  if (
    result.executionMode === "auto"
    && result.maven?.projectRoot
    && result.maven.status === "unavailable"
  ) {
    showWarningWithRecovery(
      output,
      "Kotlin is ready, but Maven is unavailable. Automatic mode will use local Kotlin.",
      ["Open Output", "Use Local Kotlin", "Open Settings"],
      resource,
    );
    return;
  }

  const detectedProjects: string[] = [];
  if (result.gradle.status === "available") {
    detectedProjects.push("Gradle");
  }
  if (result.maven?.status === "available") {
    detectedProjects.push("Maven");
  }
  const projectSummary = detectedProjects.length > 0 ? ` ${detectedProjects.join(" and ")} detected.` : "";
  const selected = await vscode.window.showInformationMessage(
    `Kotlin Worksheet is ready. ${result.kotlin.version ?? "Kotlin is available"}.${projectSummary}`,
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
  if (result.maven) {
    output.info(`[environment] Maven project: ${result.maven.projectRoot ?? "not detected"}`);
    if (result.maven.status === "available") {
      output.info(`[environment] Maven: available (${result.maven.command ?? "command detected"})`);
    } else if (result.maven.status === "unavailable") {
      output.warn(`[environment] Maven: unavailable (${result.maven.error ?? "unknown reason"})`);
    } else {
      output.info("[environment] Maven: not needed");
    }
  }
  if (result.daemon) {
    output.info(`[environment] Daemon: available=${result.daemon.available}, running=${result.daemon.running}`);
  }
  output.info(`[environment] Ready: ${result.ready}`);
}

function cancelActiveRun(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file to cancel a worksheet run.`);
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

function resolveExecutionMode(
  requestedMode: ExecutionMode,
  gradleRoot: string | undefined,
  mavenRoot: string | undefined,
): "localKotlinc" | "gradleClasspath" | "mavenClasspath" {
  if (requestedMode === "localKotlinc") {
    return "localKotlinc";
  }

  if (requestedMode === "gradleClasspath") {
    return "gradleClasspath";
  }

  if (requestedMode === "mavenClasspath") {
    return "mavenClasspath";
  }

  if (gradleRoot) {
    return "gradleClasspath";
  }

  if (mavenRoot) {
    return "mavenClasspath";
  }

  return "localKotlinc";
}

async function refreshGradleClasspath(output: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file to refresh its Gradle classpath.`);
    return;
  }

  const documentDir = path.dirname(editor.document.fileName);
  const gradleRoot = await locateGradleProjectRoot(documentDir);
  if (!gradleRoot) {
    void vscode.window.showInformationMessage("No Gradle project was found for this worksheet.");
    return;
  }

  const cleared = gradleClasspathCache.clear(gradleRoot, documentDir);
  output.info(`Gradle classpath cache refreshed for ${gradleRoot}; cleared ${cleared} entr${cleared === 1 ? "y" : "ies"}.`);
  void vscode.window.setStatusBarMessage("Kotlin Worksheet Gradle classpath cache refreshed", 2500);
}

async function refreshMavenClasspath(output: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file to refresh its Maven classpath.`);
    return;
  }

  const documentDir = path.dirname(editor.document.fileName);
  const mavenRoot = await locateMavenProjectRoot(documentDir);
  if (!mavenRoot) {
    void vscode.window.showInformationMessage("No Maven project (pom.xml) was found for this worksheet.");
    return;
  }

  const cleared = mavenClasspathCache.clear(mavenRoot, documentDir);
  output.info(`Maven classpath cache refreshed for ${mavenRoot}; cleared ${cleared} entr${cleared === 1 ? "y" : "ies"}.`);
  void vscode.window.setStatusBarMessage("Kotlin Worksheet Maven classpath cache refreshed", 2500);
}

async function restartDaemon(output: vscode.LogOutputChannel): Promise<void> {
  output.info("Restarting Kotlin Worksheet daemon...");
  await shutdownSharedKotlinDaemon();
  void vscode.window.setStatusBarMessage("Kotlin Worksheet daemon restarted", 2500);
}

function logGradleCacheStatus(
  output: vscode.LogOutputChannel,
  logPrefix: string,
  status: "hit" | "miss" | "invalidated" | "shared" | "disabled",
): void {
  switch (status) {
    case "hit":
      output.info(`${logPrefix} Gradle classpath cache hit.`);
      return;
    case "miss":
      output.info(`${logPrefix} Gradle classpath cache miss.`);
      return;
    case "invalidated":
      output.info(`${logPrefix} Gradle classpath cache invalidated; resolved fresh classpath.`);
      return;
    case "shared":
      output.info(`${logPrefix} Gradle classpath resolution shared with an active request.`);
      return;
    case "disabled":
      output.info(`${logPrefix} Gradle classpath cache disabled.`);
      return;
  }
}

function logMavenCacheStatus(
  output: vscode.LogOutputChannel,
  logPrefix: string,
  status: "hit" | "miss" | "invalidated" | "shared" | "disabled",
): void {
  switch (status) {
    case "hit":
      output.info(`${logPrefix} Maven classpath cache hit.`);
      return;
    case "miss":
      output.info(`${logPrefix} Maven classpath cache miss.`);
      return;
    case "invalidated":
      output.info(`${logPrefix} Maven classpath cache invalidated; resolved fresh classpath.`);
      return;
    case "shared":
      output.info(`${logPrefix} Maven classpath resolution shared with an active request.`);
      return;
    case "disabled":
      output.info(`${logPrefix} Maven classpath cache disabled.`);
      return;
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
    void vscode.window.showInformationMessage(`Kotlin worksheets must end with ${WORKSHEET_SUFFIX_DESCRIPTION}.`);
    return;
  }

  const cleaned = stripResultComments(editor.document.getText());
  if (cleaned !== editor.document.getText()) {
    await replaceDocumentText(editor.document, cleaned);
  }
  clearWorksheetDecorations(editor.document, resultDecoration);
  decorationResultsByDocument.delete(editor.document.uri.toString());
  latestWorksheetResultsByDocument.delete(editor.document.uri.toString());
  diagnostics.delete(editor.document.uri);
}

async function toggleRunOnSave(): Promise<boolean | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isWorksheetPath(editor.document.fileName)) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file to toggle Kotlin worksheet auto-run.`);
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
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file to toggle worksheet render mode.`);
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
  await createWorksheetDocument(WORKSHEET_TEMPLATES[0].content, preselectedFolder);
}

async function newWorksheetFromTemplate(preselectedFolder?: vscode.WorkspaceFolder): Promise<void> {
  const chosen = await vscode.window.showQuickPick(
    WORKSHEET_TEMPLATES.map((t) => ({
      label: t.label,
      description: t.description,
      template: t,
    })),
    { placeHolder: "Select a Kotlin Worksheet template" },
  );
  if (!chosen) {
    return;
  }
  await createWorksheetDocument(chosen.template.content, preselectedFolder);
}

async function createWorksheetDocument(
  content: string,
  preselectedFolder?: vscode.WorkspaceFolder,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    const document = await vscode.workspace.openTextDocument({ language: "kotlin", content });
    await vscode.window.showTextDocument(document);
    void vscode.window.showInformationMessage(`Save this file with the ${WORKSHEET_SUFFIX_DESCRIPTION} suffix to run it.`);
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

async function exportToKotlin(target?: vscode.Uri | string): Promise<void> {
  const document = resolveWorksheetDocument(target);
  if (!document) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
    return;
  }

  const exported = exportToKotlinFile(document.getText());
  const exportedDoc = await vscode.workspace.openTextDocument({ language: "kotlin", content: exported });
  await vscode.window.showTextDocument(exportedDoc, { viewColumn: vscode.ViewColumn.Beside });
  void vscode.window.showInformationMessage("Worksheet exported to Kotlin source.");
}

async function exportToTest(target?: vscode.Uri | string): Promise<void> {
  const document = resolveWorksheetDocument(target);
  if (!document) {
    void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
    return;
  }

  const uri = document.uri.toString();
  const results = latestWorksheetResultsByDocument.get(uri)
    ?? decorationResultsByDocument.get(uri)
    ?? parseWorksheetResults(document.getText());

  const base = path.basename(document.fileName).replace(/\.worksheet\.(?:kts|kt)$/, "");
  const className = `${base.charAt(0).toUpperCase()}${base.slice(1)}WorksheetTest`;

  const exported = exportToTestFile(document.getText(), results, { className });
  const exportedDoc = await vscode.workspace.openTextDocument({ language: "kotlin", content: exported });
  await vscode.window.showTextDocument(exportedDoc, { viewColumn: vscode.ViewColumn.Beside });
  void vscode.window.showInformationMessage("Worksheet exported to Kotlin test.");
}

function resolveWorksheetDocument(target?: vscode.Uri | string): vscode.TextDocument | undefined {
  if (target) {
    const targetStr = typeof target === "string" ? target : target.toString();
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.toString() === targetStr && isWorksheetPath(doc.fileName)) {
        return doc;
      }
    }
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && isWorksheetPath(editor.document.fileName)) {
    return editor.document;
  }
  return undefined;
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
    requestedExecutionMode: config.get<ExecutionMode>("executionMode", "auto"),
  });
  status.text = presentation.text;
  status.tooltip = presentation.tooltip;
  status.command = presentation.command;
  status.show();
}

async function nextWorksheetUri(folderUri: vscode.Uri): Promise<vscode.Uri> {
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? `worksheet${WORKSHEET_SUFFIX}` : `worksheet-${index}${WORKSHEET_SUFFIX}`;
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
  diagnostics: Array<{ sourceLine: number; sourceColumn: number; severity: "error" | "warning" | "info"; message: string }>,
): void {
  const vscodeDiagnostics = diagnostics.map((diagnostic) => {
    const line = Math.max(0, Math.min(document.lineCount - 1, diagnostic.sourceLine - 1));
    const character = Math.max(0, diagnostic.sourceColumn - 1);
    const range = new vscode.Range(line, character, line, character + 1);
    const item = new vscode.Diagnostic(
      range,
      diagnostic.message,
      diagnostic.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : diagnostic.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information,
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
  decorationResultsByDocument.set(document.uri.toString(), new Map(results));
}

function mergeWorksheetResults(
  previous: Map<number, string>,
  next: Map<number, string>,
  range: WorksheetRange,
): Map<number, string> {
  const merged = new Map(previous);
  for (const line of Array.from(merged.keys())) {
    if (line >= range.startLine && line <= range.endLine) {
      merged.delete(line);
    }
  }
  for (const [line, result] of next) {
    if (line >= range.startLine && line <= range.endLine) {
      merged.set(line, result);
    }
  }
  return merged;
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
  decorationResultsByDocument.delete(docKey);
}

class KotlinWorksheetResultProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    const docUri = params.get("uri");
    const lineStr = params.get("line");
    if (!docUri || !lineStr) {
      return "No worksheet result specified.";
    }
    const line = parseInt(lineStr, 10);
    const result = getWorksheetResultForLineByUri(docUri, line);
    if (!result) {
      return `No worksheet result recorded for line ${line}.`;
    }

    try {
      const parsed = JSON.parse(result);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return result;
    }
  }
}

function getWorksheetResultForLineByUri(docUri: string, line: number): string | undefined {
  const latest = latestWorksheetResultsByDocument.get(docUri)?.get(line);
  if (latest !== undefined) {
    return latest;
  }
  const decorated = decorationResultsByDocument.get(docUri)?.get(line);
  if (decorated !== undefined) {
    return decorated;
  }
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.toString() === docUri) {
      return parseWorksheetResults(doc.getText()).get(line);
    }
  }
  return undefined;
}

function createWorksheetHoverProvider(): vscode.HoverProvider {
  return {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
      if (!isWorksheetPath(document.fileName)) {
        return undefined;
      }
      const line = position.line + 1;
      const result = getWorksheetResultForLineByUri(document.uri.toString(), line);
      if (!result) {
        return undefined;
      }

      const config = vscode.workspace.getConfiguration("kotlinWorksheet", document.uri);
      const maxResultLength = config.get<number>("maxResultLength", 500);
      const isTruncated = isWorksheetResultTruncated(result, maxResultLength);

      const inspectArgs = encodeURIComponent(JSON.stringify({ uri: document.uri.toString(), line }));
      const copyArgs = encodeURIComponent(JSON.stringify({ uri: document.uri.toString(), line }));

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`**Kotlin Worksheet Result** (Line ${line})\n\n`);
      md.appendCodeblock(formatWorksheetResult(result, 1000), "kotlin");

      if (isTruncated) {
        md.appendMarkdown(`\n\n*(Truncated in editor to ${maxResultLength} characters)*\n\n`);
      }
      md.appendMarkdown(
        `\n\n[$(search) Inspect Full Output](command:kotlinWorksheet.inspectResult?${inspectArgs}) | [$(copy) Copy Result](command:kotlinWorksheet.copyResult?${copyArgs})`,
      );

      const textLine = document.lineAt(position.line);
      return new vscode.Hover(md, textLine.range);
    },
  };
}

async function inspectResult(args?: { uri?: string; line?: number } | number): Promise<void> {
  let docUri: string;
  let line: number;

  if (typeof args === "number") {
    line = args;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    docUri = editor.document.uri.toString();
  } else if (args && typeof args.line === "number") {
    line = args.line;
    docUri = args.uri ?? vscode.window.activeTextEditor?.document.uri.toString() ?? "";
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isWorksheetPath(editor.document.fileName)) {
      void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
      return;
    }
    line = editor.selection.active.line + 1;
    docUri = editor.document.uri.toString();
  }

  const result = getWorksheetResultForLineByUri(docUri, line);
  if (!result) {
    void vscode.window.showInformationMessage(`No worksheet result found on line ${line}.`);
    return;
  }

  let ext = "txt";
  try {
    JSON.parse(result);
    ext = "json";
  } catch {
    // Leave as txt
  }

  const query = new URLSearchParams({ uri: docUri, line: String(line) }).toString();
  const uri = vscode.Uri.parse(`kotlin-worksheet-result://inspect/Line-${line}-Result.${ext}?${query}`);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

async function copyResult(args?: { uri?: string; line?: number } | number): Promise<void> {
  let docUri: string;
  let line: number;

  if (typeof args === "number") {
    line = args;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    docUri = editor.document.uri.toString();
  } else if (args && typeof args.line === "number") {
    line = args.line;
    docUri = args.uri ?? vscode.window.activeTextEditor?.document.uri.toString() ?? "";
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isWorksheetPath(editor.document.fileName)) {
      void vscode.window.showInformationMessage(`Open a ${WORKSHEET_SUFFIX_DESCRIPTION} file first.`);
      return;
    }
    line = editor.selection.active.line + 1;
    docUri = editor.document.uri.toString();
  }

  const result = getWorksheetResultForLineByUri(docUri, line);
  if (!result) {
    void vscode.window.showInformationMessage(`No worksheet result found on line ${line}.`);
    return;
  }

  await vscode.env.clipboard.writeText(result);
  void vscode.window.showInformationMessage(`Worksheet result for line ${line} copied to clipboard.`);
}
