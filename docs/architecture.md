# Architecture

The extension is split into three small layers.

## VS Code Adapter

`src/extension.ts` owns VS Code integration:

- command registration
- save-triggered worksheet execution
- workspace trust checks
- diagnostics
- document edits
- output channel messages

The adapter delegates evaluation to the executor and keeps VS Code APIs out of the core worksheet logic.

## Worksheet Model

`src/worksheet.ts` owns text-level behavior:

- detect `.worksheet.kts` files
- strip generated result comments
- instrument Kotlin script text
- parse marker-delimited stdout
- map Kotlin compiler diagnostics back to source lines
- apply inline `// => ...` comments
- truncate long inline results according to the configured limit

The evaluator instruments scripts by inserting marker prints and explicit `println(...)` calls around simple worksheet expressions. This avoids relying on `kotlinc -script` display behavior, which does not reliably emit bare expression values once instrumentation is inserted.

## Executor

`src/executor.ts` owns process execution:

- writes instrumented source to a temporary `.kts` file
- runs `kotlinc -script <temp-file>`
- enforces the configured timeout
- removes temporary files
- returns parsed results and diagnostics

The MVP intentionally uses the local Kotlin CLI. Gradle classpath support should be added as a separate execution backend rather than mixed into this executor.

## Data Flow

1. VS Code command or save event calls `runWorksheetDocument`.
2. Existing generated result comments are stripped.
3. Source is instrumented with marker output.
4. The temporary script runs through `kotlinc -script`.
5. Stdout is split into per-line results using markers.
6. Stderr diagnostics are mapped from generated script lines to worksheet lines.
7. Successful results are written back into the worksheet as `// => ...`.
