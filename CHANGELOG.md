# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning once releases begin.

## [Unreleased]

## [0.3.0] - 2026-07-02

### Added

- Gradle fixture smoke test for worksheets that import compiled project classes.
- Final repository, issue tracker, homepage, and Marketplace banner metadata.

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
- Gradle-aware execution mode with local fallback.

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
