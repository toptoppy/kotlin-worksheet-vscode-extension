# Architecture

Kotlin Worksheet separates VS Code integration, execution state, environment detection, process execution, Gradle resolution, and worksheet text processing.

## VS Code Adapter

`src/extension.ts` owns user-facing VS Code integration:

- command registration and native walkthrough actions
- manual and save-triggered execution
- workspace trust checks and recovery notifications
- staged progress, status bar state, and cancellation
- diagnostics, document edits, and decoration lifecycle
- structured log output

The adapter coordinates the other modules and keeps VS Code APIs out of testable core behavior.

## Run State And Status

`src/run-state.ts` tracks independent worksheet runs, cancellation signals, execution stages, resolved modes, outcomes, and durations. It publishes state changes without depending on VS Code.

`src/status.ts` converts run state and configuration into status-bar text, tooltips, and commands.

## Environment Inspection

`src/environment.ts` checks workspace-safe execution prerequisites:

- configured Kotlin command and version
- requested execution mode
- nearby Gradle project
- Gradle wrapper or executable availability

Configured tools are not executed while the workspace is untrusted.

## Worksheet Model

`src/worksheet.ts` owns text-level behavior:

- detect `.worksheet.kts` files
- strip and apply generated result comments
- instrument Kotlin source with result markers
- parse marker-delimited stdout and filter internal markers
- map Kotlin compiler diagnostics back to source lines
- format and truncate displayed results

Instrumentation inserts marker prints and explicit `println(...)` calls around supported expressions because `kotlinc -script` does not consistently display bare expression values.

## Kotlin Executor

`src/executor.ts` owns one worksheet execution:

- write instrumented source to a temporary `.kts` file
- build the local Kotlin invocation and optional classpath arguments
- invoke the process layer
- parse results and diagnostics
- remove temporary files

## Process Layer

`src/process.ts` runs captured child processes with timeout and cancellation handling. On Unix it terminates process groups so child processes do not survive a cancelled or timed-out worksheet.

## Gradle Integration

`src/gradle.ts` detects Gradle projects and commands, resolves `sourceSets.main.runtimeClasspath` through a temporary init script, and reports structured failure details. Automatic mode can continue with local Kotlin when classpath resolution fails; required Gradle mode treats resolution failure as terminal.

## Data Flow

1. A command or save event starts a per-document run.
2. Existing generated result comments are removed from the execution source.
3. The requested execution mode is resolved.
4. Gradle classpath resolution runs when applicable.
5. Worksheet source is instrumented and written to a temporary script.
6. The process layer executes Kotlin with timeout and cancellation support.
7. Marker output becomes per-line results and compiler diagnostics map back to source lines.
8. Results are applied as inline comments or cached editor decorations.
9. Run state, status UI, diagnostics, and structured logs receive the terminal outcome.
