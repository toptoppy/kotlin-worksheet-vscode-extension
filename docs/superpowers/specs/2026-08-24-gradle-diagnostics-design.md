# Gradle Diagnostics Design

## Goal

Make Gradle-backed worksheet failures understandable and actionable without
changing the supported Gradle layouts, execution modes, or configuration
surface.

## Scope

### Included

- Add a stable `GradleFailureKind` classification for Gradle classpath failures.
- Preserve the existing `GradleClasspathResult` shape and raw command output.
- Classify structured failures before inspecting known Gradle stderr patterns.
- Carry the failure kind into extension error handling.
- Show concise reason-specific recovery messages while retaining full details in
  the Kotlin Worksheet Output channel.
- Add unit, extension-host, and regression coverage.
- Update troubleshooting and support documentation.

### Excluded

- New Gradle project layouts or Android/Kotlin Multiplatform support.
- Persistent diagnostic reports or log files.
- New VS Code commands or settings.
- Changes to successful Gradle classpath resolution.

## Failure Model

The classifier will expose these kinds:

- `missingCommand`: no wrapper or Gradle executable could start.
- `timeout`: Gradle resolution exceeded the configured timeout.
- `cancelled`: the active worksheet run was cancelled.
- `missingProject`: no Gradle project contains the worksheet directory.
- `unsupportedLayout`: the selected project has no usable `sourceSets.main`
  runtime classpath.
- `dependencyResolution`: Gradle could not resolve project dependencies or
  download required artifacts.
- `emptyClasspath`: resolution completed without usable classpath entries.
- `gradleFailure`: an uncategorized Gradle failure.

`classifyGradleFailure(result)` will prioritize `timedOut`, `cancelled`, and
`startError`, then classify known messages such as missing project, missing
source sets, missing main source sets, and dependency-resolution failures. Any
unrecognized stderr remains `gradleFailure`. The original stderr, stdout, and
exit code remain available to callers.

`describeGradleFailure(result)` will continue returning a human-readable string
and will include the most useful first detail line for uncategorized failures.

## Extension Behavior

`GradleResolutionError` will carry both the failure kind and display message.

In automatic mode, the extension will:

1. Log the failure kind and detailed reason.
2. Show a warning explaining that local Kotlin execution will be used.
3. Offer Output, local Kotlin, and Settings recovery actions.

In explicit `gradleClasspath` mode, the extension will:

1. Log the failure kind and detailed reason.
2. Show an error stating why Gradle execution could not continue.
3. Offer Output, local Kotlin, and Settings recovery actions.

Reason-specific copy will be concise:

- Missing command: install Gradle or add a wrapper.
- Timeout: increase `kotlinWorksheet.timeoutMs` or inspect Gradle performance.
- Dependency resolution: inspect dependency declarations, repositories, network,
  and the Gradle Output log.
- Unsupported layout: expose a JVM `sourceSets.main.runtimeClasspath` or use
  local Kotlin.
- Empty or generic failure: inspect the full Gradle Output log.

No failure detail will be silently discarded, and automatic fallback will remain
visible rather than silent.

## Verification

- Unit tests cover every failure kind and representative stderr patterns.
- Existing timeout, cancellation, missing-command, and empty-classpath tests
  remain passing.
- Extension-host tests verify that automatic fallback includes a reason and
  explicit Gradle mode presents a classified failure.
- Existing successful Java, subproject, and Arrow Gradle tests remain passing.
- Troubleshooting and support documentation explain the supported layout and
  recovery options.

## Acceptance Criteria

- A customer can distinguish missing tooling, unsupported layout, dependency
  failure, timeout, cancellation, and generic Gradle failure from the error or
  warning shown by the extension.
- The Output channel contains the original Gradle detail for diagnosis.
- Automatic fallback explains why it occurred.
- Explicit Gradle mode does not silently fall back.
- Successful Gradle execution and existing cache behavior are unchanged.
