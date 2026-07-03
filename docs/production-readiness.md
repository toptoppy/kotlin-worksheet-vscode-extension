# Production Readiness

This checklist tracks the work needed before publishing or promoting Kotlin Worksheet.

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
- Marketplace icon and banner metadata.
- Actionable error when the configured Kotlin command cannot start.

## Remaining Release QA

- Test the packaged VSIX in clean VS Code profiles on macOS, Linux, and Windows.
- Verify `Kotlin Worksheet: Run` on a sample `.worksheet.kts` file.
- Verify run-on-save behavior.
- Verify the status bar toggle switches between manual and auto-run-on-save modes.
- Verify render mode toggles between inline comments and decorations.
- Verify execution mode auto-detects Gradle projects and falls back to local `kotlinc`.
- Verify `Kotlin Worksheet: Clear Results`.
- Verify missing `kotlinc` error messaging.
- Verify timeout and cancellation behavior from the VS Code progress notification.
- Keep CI and docs pinned to `kotlinc-jvm 2.4.0` unless the supported version changes intentionally.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Release Preparation

- Update `CHANGELOG.md` for each release.
- Run `pnpm check`.
- Package the VSIX with `pnpm package`.
- Install and smoke-test the packaged VSIX.
- Tag the release after publishing.

## Future Production Enhancements

- Add optional virtual decoration result rendering.
- Add VS Code integration tests with the Extension Development Host.
- Add marketplace screenshots or GIFs.
- Add telemetry-free usage diagnostics in the output channel for troubleshooting.
