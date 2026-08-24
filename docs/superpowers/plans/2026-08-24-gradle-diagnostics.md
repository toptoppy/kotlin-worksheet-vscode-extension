# Gradle Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify Gradle classpath failures and provide actionable, reason-specific recovery messages without changing successful Gradle execution or supported layouts.

**Architecture:** Add a pure failure classifier and user-message formatter beside the existing Gradle resolver. The extension will carry the classification through `GradleResolutionError`, log the structured kind, and use the formatter for automatic fallback and explicit Gradle-mode errors. Existing raw stdout/stderr and `GradleClasspathResult` fields remain unchanged.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Mocha VS Code integration tests, pnpm.

## Global Constraints

- The goal is to make Gradle-backed worksheet failures understandable and actionable without changing the supported Gradle layouts, execution modes, or configuration surface.
- Preserve the existing `GradleClasspathResult` shape and raw command output.
- No new Gradle project layouts or Android/Kotlin Multiplatform support.
- No persistent diagnostic reports or log files.
- No new VS Code commands or settings.
- Do not change successful Gradle classpath resolution.
- Automatic fallback remains visible rather than silent.
- Do not commit changes unless explicitly requested by the user.

---

## File Map

- Modify `src/gradle.ts`: failure-kind union, classifier, detail formatter, and recovery copy.
- Modify `src/extension.ts`: carry failure kind through errors, log classification, and use reason-specific messages.
- Modify `test/gradle.test.ts`: unit coverage for classification and user-facing descriptions.
- Modify `test/integration/suite/extension.test.ts`: explicit Gradle failure behavior and visible fallback path regression coverage.
- Modify `docs/user-guide.md`: supported layout and recovery guidance.
- Modify `docs/walkthrough/troubleshoot.md`: reason-specific troubleshooting steps.
- Modify `docs/examples.md`: clarify automatic fallback behavior and Output diagnostics.
- Modify `CHANGELOG.md`: record the unreleased diagnostics improvement.

## Task 1: Add Typed Gradle Failure Classification

**Files:**
- Modify: `src/gradle.ts:9-47`
- Modify: `test/gradle.test.ts:62-90`

**Interfaces:**
- Consumes: existing `GradleClasspathResult` fields.
- Produces: `GradleFailureKind`, `classifyGradleFailure(result)`, `describeGradleFailure(result)`, and `describeGradleFailureForUser(kind, detail?)`.

- [ ] **Step 1: Add failing classifier tests.**

Add tests for the structured and stderr-driven categories:

```ts
describe("gradle failure classification", () => {
  it.each([
    ["timed out", { timedOut: true }, "timeout"],
    ["cancelled", { cancelled: true }, "cancelled"],
    ["missing command", { startError: "No Gradle wrapper or gradle command found." }, "missingCommand"],
    ["missing project", { stderr: "No Gradle project contains the worksheet directory." }, "missingProject"],
    ["unsupported layout", { stderr: "No sourceSets extension found on project ':app'." }, "unsupportedLayout"],
    ["missing main source set", { stderr: "No main source set found on project ':app'." }, "unsupportedLayout"],
    ["dependency resolution", { stderr: "Could not resolve all files for configuration ':runtimeClasspath'." }, "dependencyResolution"],
    ["empty classpath", {}, "emptyClasspath"],
  ])("classifies %s", (_name, overrides, expected) => {
    expect(classifyGradleFailure({
      classpath: [],
      stderr: "",
      timedOut: false,
      cancelled: false,
      ...overrides,
    })).toBe(expected);
  });

  it("keeps the first useful detail for an unknown Gradle failure", () => {
    expect(describeGradleFailure({
      classpath: [],
      stderr: "Configuration failed\\nMore details",
      timedOut: false,
      cancelled: false,
    })).toBe("Configuration failed");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `pnpm vitest run test/gradle.test.ts -t "gradle failure classification"`

Expected: FAIL because `classifyGradleFailure` and the new classification values do not yet exist.

- [ ] **Step 3: Add the failure-kind type and classifier.**

Add this public type to `src/gradle.ts`:

```ts
export type GradleFailureKind =
  | "missingCommand"
  | "timeout"
  | "cancelled"
  | "missingProject"
  | "unsupportedLayout"
  | "dependencyResolution"
  | "emptyClasspath"
  | "gradleFailure";
```

Implement `classifyGradleFailure` with this priority:

1. `timedOut` -> `timeout`.
2. `cancelled` -> `cancelled`.
3. `startError` -> `missingCommand`, except messages containing `No Gradle project` -> `missingProject`.
4. Stderr containing `No Gradle project contains` -> `missingProject`.
5. Stderr containing `No sourceSets extension`, `No main source set`, or `runtimeClasspath` layout errors -> `unsupportedLayout`.
6. Stderr containing `Could not resolve`, `Could not find`, `Could not get`, `Failed to resolve`, or `Unable to resolve` -> `dependencyResolution`.
7. Empty classpath -> `emptyClasspath`.
8. Otherwise -> `gradleFailure`.

Keep `describeGradleFailure` returning a string for existing callers and tests. Add `describeGradleFailureForUser(kind, detail?)` that returns concise copy for the eight kinds and appends the first useful detail line for `gradleFailure`.

- [ ] **Step 4: Run the focused tests and the full Gradle unit file.**

Run: `pnpm vitest run test/gradle.test.ts -t "gradle failure classification"`

Expected: all classification tests pass.

Run: `pnpm vitest run test/gradle.test.ts`

Expected: all Gradle tests, including Java, subproject, Arrow, and failure-description coverage, pass.

## Task 2: Propagate Classification Through Extension Recovery

**Files:**
- Modify: `src/extension.ts:37-45,335-360,500-525,596-612`
- Modify: `test/integration/suite/extension.test.ts:240-343`

**Interfaces:**
- Consumes: `GradleFailureKind`, `classifyGradleFailure`, `describeGradleFailure`, and `describeGradleFailureForUser` from `src/gradle.ts`.
- Produces: classified explicit-mode errors and reason-specific automatic fallback messages while preserving existing recovery actions.

- [ ] **Step 1: Add a failing pure behavior assertion for reason-specific copy.**

Extend `test/gradle.test.ts` with formatter assertions:

```ts
it("formats actionable recovery copy for Gradle failure kinds", () => {
  expect(describeGradleFailureForUser("missingCommand", "No Gradle wrapper or gradle command found.")).toContain(
    "Install Gradle or add a Gradle wrapper",
  );
  expect(describeGradleFailureForUser("dependencyResolution", "Could not resolve all files")).toContain(
    "dependencies, repositories, or network access",
  );
  expect(describeGradleFailureForUser("unsupportedLayout", "No sourceSets extension")).toContain(
    "sourceSets.main.runtimeClasspath",
  );
});
```

- [ ] **Step 2: Run the formatter test and verify it fails.**

Run: `pnpm vitest run test/gradle.test.ts -t "actionable recovery copy"`

Expected: FAIL because the formatter does not yet exist.

- [ ] **Step 3: Carry failure kind through `GradleResolutionError`.**

Change the class to store the kind without altering the public extension API:

```ts
class GradleResolutionError extends Error {
  constructor(
    readonly kind: GradleFailureKind,
    message: string,
  ) {
    super(message);
  }
}
```

When Gradle resolution returns an unsuccessful result, compute the kind once. Log it as `Gradle failure kind=<kind>` with the raw detail in the existing Output channel. In explicit mode, throw `new GradleResolutionError(kind, describeGradleFailureForUser(kind, detail))`.

For a missing `gradleRoot`, throw `new GradleResolutionError("missingProject", describeGradleFailureForUser("missingProject"))`.

In automatic mode, pass the formatted reason to `showGradleFallbackWarning`, and retain the existing `Open Output`, `Use Local Kotlin`, and `Open Settings` actions.

- [ ] **Step 4: Add extension-host regression coverage.**

Add a test that configures `executionMode` to `gradleClasspath`, opens a worksheet under a temporary project containing a Gradle marker but no `sourceSets` extension, runs the command, and asserts the worksheet remains unchanged. Keep the test focused on the failure path; the pure formatter tests verify exact copy.

Add or update the automatic-mode test so a Gradle failure leaves the worksheet executable through local Kotlin and does not silently alter the source.

- [ ] **Step 5: Run focused behavior tests.**

Run: `pnpm vitest run test/gradle.test.ts -t "actionable recovery copy"`

Expected: formatter assertions pass.

Run: `pnpm test:integration`

Expected: all extension-host tests pass, including explicit failure and automatic fallback paths.

## Task 3: Update Troubleshooting Documentation And Release Notes

**Files:**
- Modify: `docs/user-guide.md:23-25,225-240`
- Modify: `docs/walkthrough/troubleshoot.md:1-40`
- Modify: `docs/examples.md:65-80`
- Modify: `CHANGELOG.md:7-20`

**Interfaces:**
- Consumes: the final failure kinds and recovery copy from Tasks 1-2.
- Produces: customer-facing troubleshooting guidance that matches actual behavior.

- [ ] **Step 1: Document supported Gradle boundaries.**

State that Gradle classpath mode requires a project exposing JVM `sourceSets.main.runtimeClasspath`; Android, Kotlin Multiplatform, and custom layouts remain unsupported. Explain that automatic mode falls back to local Kotlin with a visible reason, while explicit Gradle mode reports an error.

- [ ] **Step 2: Add a failure-recovery table.**

Document these categories and actions:

```text
Missing Gradle command      Install Gradle or add a project wrapper.
Dependency resolution       Check repositories, dependency declarations, and network access.
Unsupported layout          Use a JVM sourceSets.main.runtimeClasspath layout or local Kotlin.
Timeout                     Increase kotlinWorksheet.timeoutMs and inspect Gradle performance.
Empty/generic failure       Open Kotlin Worksheet: Show Log for full Gradle output.
```

- [ ] **Step 3: Add the diagnostics to `Unreleased`.**

Add a concise `Changed` entry stating that Gradle failures now identify the failure category and provide recovery guidance, while preserving the existing 0.7.0 release section.

- [ ] **Step 4: Search for stale or contradictory guidance.**

Run: `rg -n "fallback|sourceSets.main.runtimeClasspath|Gradle classpath|No Gradle|dependency" README.md docs CHANGELOG.md`

Expected: every current troubleshooting reference agrees with the classifier and explicit/automatic mode behavior.

## Task 4: Complete Verification

**Files:**
- Verify all files changed by Tasks 1-3.

**Interfaces:**
- Consumes: typed classifier, extension recovery behavior, tests, and documentation.
- Produces: a verified diagnostics improvement with no regression to successful Gradle execution or caching.

- [ ] **Step 1: Review the worktree.**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors and only intended diagnostics files are changed; pre-existing `.mise.toml` remains untouched.

- [ ] **Step 2: Run unit and integration checks.**

Run: `pnpm check`

Expected: lint, TypeScript compilation, all unit tests, and packaging pass.

Run: `pnpm test:integration`

Expected: all extension-host tests pass.

- [ ] **Step 3: Run Gradle performance/regression verification.**

Run: `pnpm benchmark:gradle-cache`

Expected: cache `miss`, `hit`, `disabled`, and `invalidated` scenarios remain successful and worksheet execution still succeeds.

- [ ] **Step 4: Inspect the package and final docs.**

Run: `pnpm exec vsce ls --tree` and inspect the generated `kotlin-worksheet-0.7.0.vsix`.

Expected: user-facing troubleshooting docs are included, internal planning files are excluded, and no unsupported layout is described as supported.
