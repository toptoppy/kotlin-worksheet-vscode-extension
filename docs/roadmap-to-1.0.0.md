# Roadmap To 1.0.0

This roadmap follows the 0.5.0 release and defines the planned milestones for
the first stable release.

## v0.6.0: Interactive Evaluation

Goal: make it possible to evaluate smaller parts of a worksheet during daily
development.

Status: Planned. The repository is prepared for 0.6.0 development, but the
features below are not implemented yet.

- [ ] Run Selection command.
- [ ] Run Current Block command.
- [ ] Place results at the selected or current expression.
- [ ] Show complete output for truncated results.
- [ ] Preserve unrelated worksheet results.
- [ ] Add context-menu and editor-title commands.
- [ ] Add unit and integration coverage for selection and block execution.

Exit criteria: users can evaluate small code sections reliably.

## v0.7.0: Project Integration

Goal: make worksheets fast and reliable inside standard Kotlin JVM projects.

- [ ] Cache Gradle classpaths between runs.
- [ ] Add a classpath refresh command.
- [ ] Improve dependency and subproject resolution.
- [ ] Support more common JVM Gradle layouts.
- [ ] Improve Gradle fallback diagnostics.
- [ ] Add dependency and import examples.
- [ ] Test Gradle integration across macOS, Linux, and Windows.

Exit criteria: worksheets work reliably in normal Kotlin JVM projects.

## v0.8.0: Kotlin Compatibility

Goal: support broader Kotlin syntax without producing misleading results.

- [ ] Improve nested destructuring and complex declaration results.
- [ ] Add diagnostics for unsupported syntax.
- [ ] Improve standalone external dependency configuration.
- [ ] Improve performance for large worksheets.
- [ ] Add more Kotlin syntax fixtures and compatibility tests.
- [ ] Decide whether `.worksheet.kt` support is required.

Exit criteria: supported Kotlin behavior is documented and unsupported cases
are explicit.

## v0.9.0: Beta Hardening

Goal: stabilize behavior and freeze the public extension surface before 1.0.

- [ ] Resolve all known P0 and P1 issues.
- [ ] Run performance, timeout, and cancellation tests on all supported systems.
- [ ] Test supported Kotlin, Gradle, and VS Code upgrades.
- [ ] Polish Marketplace screenshots and documentation.
- [ ] Decide whether to publish to Open VSX.
- [ ] Document migration and compatibility notes.
- [ ] Freeze commands, settings, and worksheet suffix behavior.

Exit criteria: a stable beta is available with no planned breaking changes.

## v1.0.0: Stable Release

Goal: publish a stable, supported Kotlin worksheet experience.

Supported baseline:

- `.worksheet.kts` files.
- Local `kotlinc` execution.
- Standard Kotlin JVM Gradle projects.
- Inline comments and decoration rendering.
- Diagnostics, cancellation, timeouts, and run-on-save.
- VS Code on macOS, Linux, and Windows.

Release requirements:

- [ ] Freeze commands, settings, and `.worksheet.kts` behavior.
- [ ] Publish the complete support matrix.
- [ ] Pass CI on macOS, Linux, and Windows.
- [ ] Validate clean VSIX installation.
- [ ] Complete manual UX testing.
- [ ] Publish the Marketplace release and tag `v1.0.0`.
- [ ] Document the support and maintenance policy.

Deferred unless fully designed and tested:

- `.worksheet.kt` support.
- Android-specific projects.
- Kotlin Multiplatform projects.
- Custom webview UI.
- Arbitrary dependency resolution.

## Release Process

Each milestone requires updated documentation and changelog entries, unit and
integration tests, cross-platform CI, VSIX packaging, isolated installation
validation, and manual Marketplace publishing through the protected workflow.

See `docs/publishing.md` for the release workflow and `docs/roadmap-0.5.0.md`
for the completed 0.5.0 scope.
