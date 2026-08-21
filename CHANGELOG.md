# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning once releases begin.

## [Unreleased]

### Changed

- Hardened process timeout and cancellation ownership to prevent conflicting
  terminal states and duplicate force-kill timers.
- Made Gradle temporary directories collision-safe and cancellation-aware.
- Prevented stale worksheet results from applying after edits or document close.

### Planned For 0.6.0

- Functional type display for explicitly typed lambdas and same-worksheet
  function references.
- Run Selection and Run Current Block commands for focused worksheet evaluation.
- Result placement that preserves unrelated worksheet results.
- Editor title and context-menu actions for interactive evaluation.
- Unit and Extension Development Host coverage for selection and block runs.

### Implemented In 0.6.0 Development

- Function declarations now show supported function types without executing
  their bodies.
- Supported lambdas and same-worksheet function references show inferred
  function types.
- Normal expressions continue to show evaluated values.
- `println` and runtime side effects are reported in Runtime Output.
- Added Run Selection and Run Current Block commands with preceding worksheet
  context and unrelated-result preservation.

## [0.7.0] - 2026-08-18

### Added

- Added an Arrow Core Gradle fixture using Maven Central and pinned dependency
  coverage for Kotlin JVM projects.
- Added Gradle integration coverage for Arrow `Either` and `Option`
  transformations.
- Added root-project and nearest-subproject Gradle classpath coverage.
- Cached successful Gradle classpath resolutions and reused them until Gradle
  build files or project sources change.
- Shared concurrent Gradle classpath resolution requests for the same worksheet
  project so duplicate runs do not launch duplicate Gradle work.
- Added `Kotlin Worksheet: Refresh Gradle Classpath` to clear cached classpath
  entries for the active worksheet project.
- Added `kotlinWorksheet.gradleClasspathCache.enabled` to disable Gradle
  classpath caching when needed.

### Changed

- Gradle classpath caches now invalidate for source, build, and version-catalog
  changes, and failed resolutions are not cached.
- Gradle-backed worksheet runs now log cache hits, misses, invalidations,
  disabled cache use, and shared in-flight resolutions.

## [0.6.2] - 2026-08-17

### Changed

- Added worksheet execution phase timing logs for preparation, mode detection,
  Gradle classpath resolution, Kotlin execution, result application, and total
  pipeline duration.
- Avoided duplicate Gradle project-root lookup during worksheet execution.
- Improved large stdout and stderr capture by buffering process output chunks.

## [0.6.1] - 2026-08-14

### Fixed

- Expanded function-type rendering for lambdas, anonymous functions,
  callable references, receiver functions, nested types, and nullable types.
- Kept callable-looking values such as properties, SAMs, callable objects,
  widened `Any` values, and collections on runtime-value rendering.

## [0.5.0] - 2026-08-11

### Added

- Stateful worksheet scanning that ignores braces and comment markers inside
  multiline strings, regular strings, character literals, and nested block
  comments.
- Worksheet result capture for flat destructuring declarations and multiline
  lambda expressions.
- Gradle subproject classpath resolution based on the worksheet directory.
- Worksheet and Gradle regression coverage for multiline strings, block
  comments, and multi-project builds.
- Explicit log warnings when editor results are truncated.

### Changed

- Gradle resolution now reports the selected project when a project-specific
  source set is unavailable.
- Kotlin diagnostics now accept standard and parenthesized location formats,
  including error, warning, and information prefixes.
- macOS integration tests accept VS Code bundles that use `Code` instead of
  `Electron` as the executable name.

## [0.4.0] - 2026-07-16

### Added

- Kotlin and Gradle environment check with setup recovery actions.
- Staged execution progress and per-worksheet run state with status-bar cancellation.
- Persistent structured logs with run history, durations, exit codes, and resolved execution modes.
- Native getting-started walkthrough for environment setup, worksheet creation, execution, results, and troubleshooting.
- Command-level extension-host coverage for execution, timeout, cancellation, run-on-save, diagnostics, render modes, and multi-root creation.

### Changed

- Run-on-save now uses quiet status-bar progress instead of repeated notifications.
- Error and trust notifications now provide direct actions for settings, logs, Problems, setup guidance, and workspace trust.
- Gradle automatic fallback is visible and can switch future runs to local Kotlin.
- The status bar now reports Ready, Running, Passed, Failed, Cancelled, and Timed Out with mode and duration details.
- Worksheet settings now include ordered enum descriptions and clearer mode trade-offs.
- Editor context menus now focus on Run and Clear Results.
- New Worksheet asks for a destination in multi-root workspaces.

### Fixed

- Internal worksheet instrumentation markers no longer appear in user-visible stdout.
- Decoration results are cached and restored when editors become visible.
- Stale diagnostics and decoration state are cleared on edits, close, mode changes, and Clear Results.
- Switching to decoration mode now removes generated inline comments automatically.
- Run-on-save uses the declared disabled default consistently.
- Integration tests now compile current extension code before launching VS Code.

### Removed

- Redundant `Kotlin Worksheet: Rerun` command.

## [0.3.1] - 2026-07-16

### Added

- Marketplace install link in README and user guide.
- Marketplace extension icon.
- Publishing, version update, and maintenance guide.
- VS Code Extension Development Host integration tests.

### Changed

- Consolidated release action items into the production-readiness document.
- CI now checks Linux, macOS, and Windows and runs Kotlin and Gradle integration coverage on Linux.
- Run-on-save documentation now reflects its optional default.

### Fixed

- Integration test files are excluded from the published VSIX.
- Gradle fixture tests require both Gradle and Kotlin before execution.

## [0.3.0] - 2026-07-02

### Added

- Gradle fixture smoke test for worksheets that import compiled project classes.
- Final repository, issue tracker, homepage, and Marketplace banner metadata.
- Gradle classpath resolution now runs without a persistent Gradle daemon.
- Visual Studio Marketplace publisher ID.

## [0.2.0] - 2026-06-30

### Added

- CI workflow that compiles, tests, packages, and uploads the VSIX artifact.
- ESLint-based TypeScript linting gate.
- CI and docs pinned to `kotlinc-jvm 2.4.0`.
- Configurable inline result truncation.
- Decoration-based worksheet result rendering.
- `Kotlin Worksheet: Rerun` and render-mode toggle commands.
- Gradle-aware execution mode with local fallback.
- Multi-line expression worksheet evaluation.
- Worksheet cancellation from VS Code progress notifications.
- Timeout and cancellation regression tests.
- Production-readiness checklist.

### Fixed

- Long-running worksheet cleanup now terminates the compiler process group on Unix.
- Missing or invalid Kotlin command values now show an actionable startup error.

## [0.0.1] - 2026-06-29

### Added

- Initial Kotlin worksheet VS Code extension.
- `*.worksheet.kts` detection.
- Manual run, clear results, and new worksheet commands.
- Run-on-save support with workspace trust guard.
- Inline `// => ...` result comments.
- Kotlin compiler diagnostics mapped back to worksheet lines.
- Unit tests and local `kotlinc` executor tests.
- VSIX packaging.
