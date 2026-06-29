# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog, and this project uses semantic versioning once releases begin.

## [Unreleased]

### Added

- CI workflow that compiles, tests, packages, and uploads the VSIX artifact.
- ESLint-based TypeScript linting gate.
- Configurable inline result truncation.
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
