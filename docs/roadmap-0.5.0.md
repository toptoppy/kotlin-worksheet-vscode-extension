# Kotlin Worksheet 0.5.0 Roadmap

Status: Release candidate

## Release Goal

Make worksheet evaluation reliable for real Kotlin snippets and common Gradle
projects without weakening the simple standalone `kotlinc` workflow.

## Scope

### P0: Worksheet Evaluation

- [x] **WS-01: Define supported statement boundaries**
  - Document which top-level declarations, expressions, blocks, lambdas, and
    multiline statements produce results.
  - Keep unsupported constructs from producing misleading result comments.
  - Implemented: the user guide documents result behavior and the worksheet
    test suite covers supported and intentionally unmarked constructs.

- [x] **WS-02: Improve instrumentation for complex Kotlin**
  - Handle nested braces, lambdas, strings, comments, destructuring, and
    multiline expressions without corrupting the generated script.
  - Implemented: stateful scanning now protects strings, character literals,
    nested block comments, multiline constructs, flat destructuring declarations,
    and multiline lambdas from false boundaries.
  - Remaining: add broader syntax fixtures before calling this complete for all
    complex Kotlin constructs.

- [x] **WS-03: Preserve source mapping**
  - Keep compiler diagnostics and result locations mapped to the original
    worksheet after instrumentation adds generated lines.
  - Implemented: multiline declaration diagnostics are covered by regression
    tests and map back to their original source line and column.

- [x] **WS-04: Add regression fixtures**
  - Add representative `.worksheet.kts` fixtures for multiline expressions,
    nested blocks, lambdas, destructuring, imports, and printed output.
  - Implemented: automated coverage now exercises multiline expressions,
    multiline lambdas, destructuring, imports, printed output, and source-line
    diagnostics; Gradle subproject coverage uses a dedicated fixture.

### P0: Gradle Classpaths

- [x] **GR-01: Resolve the correct Gradle project**
  - Support worksheets located in subprojects instead of always resolving the
    root project's `main` runtime classpath.
  - Implemented: the nearest project containing the worksheet directory is
    selected and its `main` runtime classpath is resolved.

- [x] **GR-02: Make Gradle limitations explicit**
  - Detect missing or unsupported `sourceSets.main.runtimeClasspath` layouts and
    explain the selected fallback or required configuration.
  - Implemented: project-specific source-set errors are returned to the
    existing fallback and explicit-mode recovery paths.

- [x] **GR-03: Test project classpath execution**
  - Extend the Gradle fixture coverage for subprojects, compiled classes, and
    dependency resolution.
  - Implemented: added a multi-project fixture and subproject classpath test.
  - Note: Gradle tests are skipped locally when `gradle` is unavailable.

### P1: Results And Diagnostics

- [x] **UX-01: Improve result rendering consistency**
  - Ensure inline comments and decorations behave consistently after edits,
    reruns, editor changes, and failed executions.
  - Implemented: generated inline results are removed after edits and before a
    run, including failed runs; integration coverage verifies both paths.

- [x] **UX-02: Improve large-result handling**
  - Make truncation visible and provide a way to inspect the complete output in
    the log or a document.
  - Implemented: the run log identifies truncated source lines and points users
    to the full stdout in the same log.

- [x] **DIAG-01: Improve compiler diagnostic presentation**
  - Preserve warnings, source columns, and useful context in the Problems view.
  - Implemented: standard and parenthesized Kotlin locations plus error,
    warning, and information prefixes are parsed without exposing temp-script
    paths in the Problems view.

### P1: Compatibility And Release Quality

- [x] **QA-01: Define the support matrix**
  - Document supported VS Code, Kotlin compiler, Gradle, and operating-system
    versions for 0.5.0.
  - Implemented: the user guide and README now share the 0.5.0 support
    baseline and Gradle limitations.

- [x] **QA-02: Expand cross-platform verification**
  - Run worksheet, timeout, cancellation, diagnostics, and VSIX installation
    checks on macOS, Linux, and Windows.
  - Implemented: the CI OS matrix now installs the pinned Kotlin toolchain and
    runs integration tests plus isolated VSIX installation on all three OSes.

- [x] **DOC-01: Add real project examples**
  - Add standalone and Gradle examples showing imports, execution modes, result
    rendering, and common setup failures.
  - Implemented: added `docs/examples.md` and linked it from the README.

- [x] **REL-01: Prepare 0.5.0 safely**
  - Update the changelog and package version, run `pnpm check`, validate the VSIX
    in an isolated profile, and complete Marketplace release QA.
  - Implemented: package version, changelog, documentation, full checks, the
    0.5.0 VSIX, and isolated installation are complete.
  - External: Marketplace publishing requires the publisher credentials and
    should be followed by tagging `v0.5.0`.

## Deferred

- `.worksheet.kt` support. Keep `.worksheet.kts` as the unambiguous worksheet
  suffix; revisit only if a concrete user workflow requires `.kt` files.
- Kotlin Multiplatform and Android-specific classpath resolution. These should
  follow a separate design once JVM Gradle subproject support is stable.
- Custom webview result UI. Prefer native VS Code comments, decorations, logs,
  and Problems surfaces unless they cannot meet a proven requirement.

## Verification

Run the standard checks before merging:

```sh
pnpm check
pnpm test:integration
pnpm test:vsix-install
```

Complete the manual worksheet flow from `docs/development.md` in a clean VS Code
profile before publishing.
