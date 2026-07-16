# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning once releases begin.

## [Unreleased]

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
