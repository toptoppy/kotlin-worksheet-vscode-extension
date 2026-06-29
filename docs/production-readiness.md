# Production Readiness

This checklist tracks the work needed before publishing Kotlin Worksheet for general use.

## Completed

- Local `kotlinc -script` evaluator.
- Workspace trust guard before executing worksheet code.
- Run, clear results, and new worksheet commands.
- Run-on-save support.
- Inline result comments with configurable truncation.
- Compiler diagnostics mapped back to worksheet source lines.
- Multi-line expression evaluation for simple expression blocks.
- Timeout and cancellation support with process-group cleanup on Unix.
- Unit and executor tests.
- CI for install, compile, test, and package.
- VSIX artifact upload in CI.
- Release, contribution, architecture, user, and development docs.

## Required Before Marketplace Publishing

- Replace the placeholder `publisher` value in `package.json` with the real Visual Studio Marketplace publisher ID.
- Add the final repository URL to `package.json` so marketplace README links can be fully clickable.
- Add a marketplace icon and banner.
- Test the packaged VSIX in clean VS Code profiles on macOS, Linux, and Windows.
- Decide whether to publish to Open VSX in addition to Visual Studio Marketplace.

## Future Production Enhancements

- Add Gradle classpath execution as a separate backend.
- Add optional virtual decoration result rendering.
- Add VS Code integration tests with the Extension Development Host.
- Add marketplace screenshots or GIFs.
- Add telemetry-free usage diagnostics in the output channel for troubleshooting.
