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
- [x] Improve missing dependency diagnostics.
- [x] Cache Gradle classpaths between runs.
- [x] Add a classpath refresh command.
- [ ] Improve dependency and subproject resolution (deferred beyond 0.7.0).
- [ ] Support Android, Kotlin Multiplatform, and custom Gradle layouts
  (deferred beyond 0.7.0).
- [ ] Support more common JVM Gradle layouts (deferred beyond 0.7.0).
- [x] Improve Gradle fallback diagnostics.
- [ ] Test Gradle integration across macOS, Linux, and Windows (pending tagged CI verification).
- [x] Add Arrow-kt setup and dependency examples in the Gradle fixture.

Exit criteria: a Kotlin JVM worksheet can import and execute Arrow-kt APIs
through the project's runtime classpath.

## v0.8.0: Modernization & Kotlin Compatibility

Goal: modernize the extension, decouple from legacy dependencies, support `.worksheet.kt`, and provide interactive result inspection.

Status: Released in v0.8.0.

- [x] Display function declaration signatures.
- [x] Analyze extension, generic, and suspend function declarations.
- [x] Improve multiline destructuring and complex declaration results.
- [x] Support more lambda and function-reference cases.
- [x] Add diagnostics for unsupported syntax that appears result-worthy but
  cannot be classified.
- [x] Support `.worksheet.kt` alongside `.worksheet.kts`.
- [x] Decouple from `fwcd.kotlin` and bundle standalone TextMate grammar.
- [x] Add interactive result hovers, full output inspector, and copy command.
- [x] Add interactive template worksheets and one-click Export to Kotlin/Test.
- [x] Fix Windows CI teardown file-lock handling.

Exit criteria: `.worksheet.kt` and `.worksheet.kts` work identically, TextMate grammar provides out-of-the-box syntax highlighting, large outputs can be inspected side-by-side, and release 0.8.0 is published.

## v0.9.0: Persistent Daemon & Ecosystem Expansion

Goal: eliminate JVM cold-start latency with a warm persistent daemon, and support Maven and standalone `@file:DependsOn`.

Status: Implemented and released in v0.9.0.

- [x] Add persistent JVM daemon mode (`kotlinWorksheet.daemon.enabled`).
- [x] Implement warm daemon process with ~130–210 ms evaluation latency (~15x speedup over cold runs) (`KotlinWorksheetDaemon.java` and `kotlin-worksheet-daemon.jar`).
- [x] Add daemon lifecycle management (auto idle shutdown, status bar indicator, restart command).
- [x] Add Maven (`pom.xml`) project classpath resolution with SHA-256 caching.
- [x] Support standalone `@file:DependsOn` and `@file:Repository` script annotations.
- [x] Improve performance and memory usage for worksheets.

Exit criteria: evaluation latency on warm runs achieves a 10x+ speedup with median latency under 250ms, and Maven projects are automatically resolved alongside Gradle.

## v0.9.5: Beta Hardening & Open VSX

Goal: stabilize behavior, broaden distribution to Open VSX, and freeze public API before 1.0.

Status: Completed.

- [x] Add automated publishing to Open VSX Registry in the release workflow.
- [x] Test Kotlin 2.x syntax (multi-dollar string interpolation, context parameters, declaration annotations).
- [x] Add incremental block state / session caching for Run Current Block.
- [x] Run performance, timeout, and cancellation tests on macOS, Linux, and Windows.
- [x] Freeze commands, settings schema, and default keybindings.
- [x] Document migration and compatibility notes.

Exit criteria: a stable beta is available across VS Marketplace and Open VSX with frozen settings.

## v1.0.0: Stable Release

Goal: publish a stable, supported Kotlin worksheet experience.

Status: Ready for 1.0.0 General Availability release.

Supported baseline:

- `.worksheet.kts` and `.worksheet.kt` files.
- Persistent daemon and local `kotlinc` execution modes.
- Kotlin JVM Gradle and Maven projects.
- Standalone worksheets with `@file:DependsOn`.
- Arrow-kt and third-party library evaluation.
- Functional type display for supported lambda and function-reference cases.
- Inline comments, decoration rendering, and Large Output Inspector.
- Diagnostics, cancellation, timeouts, and run-on-save.
- VS Code, VSCodium, and Cursor on macOS, Linux, and Windows.

Release requirements:

- [x] Freeze commands, settings, and worksheet behavior.
- [x] Publish the complete support matrix (`README.md` and `docs/support-policy.md`).
- [x] Pass cross-platform CI on macOS, Linux, and Windows.
- [x] Validate clean VSIX installation in isolated environments.
- [x] Complete manual UX testing and polish storefront media/GIFs.
- [x] Publish the 1.0.0 release to VS Marketplace and Open VSX.
- [x] Document the support and maintenance policy.

Deferred unless fully designed and tested:

- Android-specific project structures.
- Kotlin Multiplatform projects.
- Interactive live code notebook cell UI.

## Release Process

Each milestone requires updated documentation and changelog entries, unit and
integration tests, cross-platform CI, VSIX packaging, isolated installation
validation, and manual Marketplace publishing through the protected workflow.

See `docs/publishing.md` for the release workflow and `docs/roadmap-0.5.0.md`
for the completed 0.5.0 scope.
