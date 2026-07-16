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
- VS Code integration tests with the Extension Development Host.
- ESLint-based TypeScript linting.
- CI for install, compile, test, and package.
- CI Gradle fixture smoke test for worksheets importing compiled project classes.
- VSIX artifact upload in CI.
- Release, contribution, architecture, user, and development docs.
- Final repository metadata in `package.json`.
- Final Visual Studio Marketplace publisher ID in `package.json`.
- Marketplace icon and banner metadata.
- Actionable error when the configured Kotlin command cannot start.
- Environment check for workspace trust, Kotlin version, execution mode, and Gradle availability.
- Staged progress with quiet run-on-save feedback.
- Persistent structured run logs and actionable recovery notifications.
- Per-worksheet status with outcome, duration, execution mode, and cancellation.
- Reliable decoration and diagnostic lifecycle across edits and editor visibility changes.
- Native getting-started walkthrough.
- Command-level extension-host tests for core success and failure paths.
- Packaged 0.4.0 VSIX installation validated in an isolated macOS profile.
- CI installs and verifies the packaged VSIX in isolated Linux, macOS, and Windows profiles.

## Remaining Release QA

- Confirm the cross-platform isolated VSIX installation job passes in CI.
- Manually verify the walkthrough, status bar text, notification actions, and decoration appearance.
- Manually verify automatic Gradle fallback in a representative Kotlin Gradle project.
- Keep CI and docs pinned to `kotlinc-jvm 2.4.0` unless the supported version changes intentionally.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Release Preparation

- Update `CHANGELOG.md` for each release.
- Run `pnpm check`.
- Package the VSIX with `pnpm package`.
- Run `pnpm test:vsix-install` to install and verify the packaged VSIX in an isolated profile.
- Tag the release after publishing.

See `docs/publishing.md` for the detailed Marketplace publish and version update process.

## Future Production Enhancements

- Add marketplace screenshots or GIFs.
