# Production Readiness

This checklist tracks the work needed before publishing Kotlin Worksheet for general use.

For the remaining concrete task list, see `docs/action-items.md`.

## Completed

- Local `kotlinc -script` evaluator.
- Workspace trust guard before executing worksheet code.
- Run, clear results, and new worksheet commands.
- Run-on-save support.
- Inline result comments with configurable truncation.
- Compiler diagnostics mapped back to worksheet source lines.
- Multi-line expression evaluation for simple expression blocks.
- Optional decoration-based worksheet result rendering.
- Gradle-aware execution mode with local fallback.
- Timeout and cancellation support with process-group cleanup on Unix.
- Unit and executor tests.
- ESLint-based TypeScript linting.
- CI for install, compile, test, and package.
- CI Gradle fixture smoke test for worksheets importing compiled project classes.
- VSIX artifact upload in CI.
- Release, contribution, architecture, user, and development docs.
- Final repository metadata in `package.json`.
- Final Visual Studio Marketplace publisher ID in `package.json`.
- Actionable error when the configured Kotlin command cannot start.

## Required Before Marketplace Publishing

- Add a marketplace icon and banner.
- Test the packaged VSIX in clean VS Code profiles on macOS, Linux, and Windows.
- Keep CI and docs pinned to `kotlinc-jvm 2.4.0` unless the supported version changes intentionally.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Future Production Enhancements

- Add optional virtual decoration result rendering.
- Add VS Code integration tests with the Extension Development Host.
- Add marketplace screenshots or GIFs.
- Add telemetry-free usage diagnostics in the output channel for troubleshooting.
