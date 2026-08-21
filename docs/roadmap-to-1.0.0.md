# Roadmap To 1.0.0

This roadmap follows the 0.5.0 release and defines the planned milestones for
the first stable release.

## v0.6.0: Functional Types And Interactive Evaluation

Goal: make functional Kotlin types visible and make it possible to evaluate
smaller parts of a worksheet during daily development.

Status: Implemented in the 0.6.0 development tree. Release packaging and
publishing remain separate release steps.

- [x] Display function declaration types such as `(Int, Int) -> Int`.
- [x] Display same-worksheet function reference and lambda types.
- [x] Avoid runtime object output for supported function values.
- [x] Keep `println` and side-effect output in Runtime Output.
- [x] Run Selection command.
- [x] Run Current Block command.
- [x] Place results at the selected or current expression.
- [x] Preserve unrelated worksheet results.
- [x] Add context-menu and editor-title commands.
- [x] Add unit, executor, and integration coverage for functional types,
  selection, and
  block execution.

Exit criteria: functional types are reliable, users can evaluate focused
worksheet sections without disturbing unrelated results, and runtime output
is separate from worksheet values.

## v0.7.0: Arrow-kt And Gradle Dependencies

Goal: support Arrow-kt and other project dependencies through reliable Kotlin
JVM Gradle classpath integration.

- [x] Add an Arrow-kt Gradle fixture using Maven Central.
- [x] Test `Either`, `Option`, and functional transformations.
- [x] Verify dependencies from root projects and subprojects.
- [ ] Improve missing dependency diagnostics (deferred beyond 0.7.0).
- [x] Cache Gradle classpaths between runs.
- [x] Add a classpath refresh command.
- [ ] Improve dependency and subproject resolution (deferred beyond 0.7.0).
- [ ] Support Android, Kotlin Multiplatform, and custom Gradle layouts
  (deferred beyond 0.7.0).
- [ ] Support more common JVM Gradle layouts (deferred beyond 0.7.0).
- [ ] Improve Gradle fallback diagnostics (deferred beyond 0.7.0).
- [ ] Test Gradle integration across macOS, Linux, and Windows (pending tagged CI verification).
- [x] Add Arrow-kt setup and dependency examples in the Gradle fixture.

Exit criteria: a Kotlin JVM worksheet can import and execute Arrow-kt APIs
through the project's runtime classpath.

## v0.8.0: Kotlin Compatibility

Goal: support broader Kotlin syntax without producing misleading results.

- [ ] Display function declaration signatures.
- [ ] Analyze extension, generic, and suspend function declarations.
- [ ] Improve nested destructuring and complex declaration results.
- [ ] Support more lambda and function-reference cases.
- [ ] Add diagnostics for unsupported syntax.
- [ ] Improve standalone external dependency configuration.
- [ ] Improve performance for large worksheets.
- [ ] Add more Kotlin syntax fixtures and compatibility tests.
- [ ] Decide whether `.worksheet.kt` support is required after `.worksheet.kts`
  behavior is stable.

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
- Arrow-kt through Gradle project dependencies.
- Functional type display for supported lambda and function-reference cases.
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
- Arbitrary standalone dependency downloading.

## Release Process

Each milestone requires updated documentation and changelog entries, unit and
integration tests, cross-platform CI, VSIX packaging, isolated installation
validation, and manual Marketplace publishing through the protected workflow.

See `docs/publishing.md` for the release workflow and `docs/roadmap-0.5.0.md`
for the completed 0.5.0 scope.
