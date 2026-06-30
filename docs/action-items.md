# Action Items

These items remain before publishing Kotlin Worksheet for general use.

## Marketplace Setup

- Replace the placeholder `publisher` value in `package.json` with the real Visual Studio Marketplace publisher ID.
- Add the final repository URL to `package.json`.
- Add a marketplace icon.
- Add marketplace banner metadata.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Manual QA

- Install the generated VSIX in a clean VS Code profile on macOS.
- Install the generated VSIX in a clean VS Code profile on Linux.
- Install the generated VSIX in a clean VS Code profile on Windows.
- Verify `Kotlin Worksheet: Run` on a sample `.worksheet.kts` file.
- Verify run-on-save behavior.
- Verify the status bar toggle switches between manual and auto-run-on-save modes.
- Verify render mode toggles between inline comments and decorations.
- Verify execution mode auto-detects Gradle projects and falls back to local `kotlinc`.
- Verify `Kotlin Worksheet: Clear Results`.
- Verify missing `kotlinc` error messaging.
- Verify timeout and cancellation behavior from the VS Code progress notification.

## Release Preparation

- Update `CHANGELOG.md` for the release.
- Run `pnpm check`.
- Package the VSIX with `pnpm package`.
- Install and smoke-test the packaged VSIX.
- Tag the release after publishing.
