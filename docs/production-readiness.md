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

## Completed Locally For 0.7.0

- `pnpm check` passed locally, including lint, compilation, tests, and packaging.
- Arrow Core 2.2.3 resolved from Maven Central and executed through the Gradle
  runtime classpath, covering `Either` and `Option` transformations.
- Root-project and nearest-subproject Gradle classpath integration tests passed.
- The local Gradle cache benchmark verified cache hits, disabled caching, source
  invalidation, dependency-configuration invalidation, and worksheet execution.
- The packaged 0.7.0 VSIX installed successfully in an isolated local profile.

## Remaining CI

- Confirm the cross-platform worksheet integration and isolated VSIX jobs pass in CI.
- Confirm the Gradle fixture smoke and integration jobs pass in CI.

## Remaining Manual QA

- Manually verify the walkthrough, status bar text, notification actions, and decoration appearance.
- Manually verify automatic Gradle fallback in a representative Kotlin Gradle project.
- Keep CI and docs pinned to `kotlinc-jvm 2.4.0` unless the supported version changes intentionally.

## Remaining Publishing Decisions

- Decide whether to publish 0.7.0 to the Visual Studio Marketplace after CI and manual QA pass.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Release Preparation

- Update `CHANGELOG.md` for each release.
- Run `pnpm check`.
- Package the VSIX with `pnpm package`.
- Run `pnpm test:vsix-install` to install and verify the packaged VSIX in an isolated profile.
- Commit the release, create and push the matching tag before protected publishing.
- Confirm tagged CI, then run the protected Marketplace workflow and verify Marketplace/GitHub release metadata.

See `docs/publishing.md` for the detailed Marketplace publish and version update process.

## Future Production Enhancements

- Add marketplace screenshots or GIFs.
