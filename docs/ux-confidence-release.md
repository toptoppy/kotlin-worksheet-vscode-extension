# UX Confidence Release Backlog

This backlog defines the planned user-experience work for Kotlin Worksheet 0.4.0.
The release is aimed primarily at Kotlin learners and should make worksheet runs
easy to understand, troubleshoot, and recover without leaving VS Code.

## Release Goal

A new user can validate their environment, create and run a worksheet, understand
what the extension is doing, and recover from common failures without manually
searching through settings or logs.

Use native VS Code surfaces such as progress notifications, status bar items,
diagnostics, walkthroughs, and output channels. Do not introduce a custom webview
unless a native surface cannot support a required workflow.

## Delivery Order

1. Execution state and progress
2. Logging and recovery actions
3. Environment check and status UI
4. Editor reliability
5. Commands, onboarding, and worksheet creation
6. Verification, documentation, and release

## Phase 1: Execution Foundation

### UX-01: Introduce an execution state model

Status: Complete

- Track `idle`, `preparing`, `resolving`, `running`, `applying`, `succeeded`, `failed`, `cancelled`, and `timedOut` per document.
- Keep concurrent worksheet states independent.
- Store enough information to show the last result and duration for the active worksheet.
- Primary file: `src/extension.ts`.

Done when each worksheet run has an observable state and terminal outcome.

### UX-02: Improve repeated-run behavior

Status: Complete

- Replace silently ignored runs with clear feedback that the worksheet is already running.
- Provide a Cancel action for the active run.
- Dependency: UX-01.
- Primary file: `src/extension.ts`.

Done when invoking Run twice never fails silently.

### UX-03: Add staged progress

Status: Complete

- Report worksheet preparation.
- Report execution-mode detection.
- Report Gradle classpath resolution when applicable.
- Report Kotlin execution.
- Report result application.
- Dependency: UX-01.
- Primary file: `src/extension.ts`.

Done when a manual run communicates its current stage and remains cancellable.

### UX-04: Make automatic runs quiet

Status: Complete

- Keep cancellable notification progress for manual runs.
- Use status-bar progress for run-on-save.
- Avoid showing a notification on every automatic run.
- Dependencies: UX-01 and UX-03.
- Primary file: `src/extension.ts`.

Done when run-on-save remains visible without repeatedly interrupting the user.

## Phase 2: Logging

### LOG-01: Adopt `LogOutputChannel`

Status: Complete

- Replace the basic output channel with a VS Code log output channel.
- Preserve prior runs instead of clearing the channel before execution.
- Use appropriate info, warning, error, and debug levels.
- Primary file: `src/extension.ts`.

Done when users can compare multiple runs in one chronological log.

### LOG-02: Add structured run summaries

Status: Complete

- Record a run separator and worksheet path.
- Record requested and resolved execution modes.
- Record the configured Kotlin command without temporary implementation paths.
- Record whether a Gradle classpath was used.
- Record duration, exit code, and terminal state.
- Avoid logging the full classpath at the default log level.
- Dependency: LOG-01.
- Primary file: `src/extension.ts`.

Done when one log section contains enough context to diagnose a run.

### LOG-03: Filter internal output markers

Status: Complete

- Separate worksheet instrumentation records from learner-visible standard output.
- Preserve parsed worksheet results.
- Add unit coverage for mixed program output and marker output.
- Primary files: `src/executor.ts`, `src/worksheet.ts`, `test/executor.test.ts`, and `test/worksheet.test.ts`.

Done when internal marker lines never appear as user program output.

### LOG-04: Explain Gradle fallback

Status: Complete

- Log a warning when automatic Gradle classpath resolution fails.
- State clearly that execution is continuing with local Kotlin.
- Include the Gradle failure reason at an appropriate log level.
- Dependency: LOG-01.
- Primary files: `src/extension.ts` and, if needed, `src/gradle.ts`.

Done when automatic fallback is never silent.

## Phase 3: Errors and Recovery

### ERR-01: Add reusable notification actions

Status: Complete

- Standardize Open Output, Open Settings, Show Problems, Show Setup Guide, and Manage Workspace Trust actions.
- Keep learner-facing messages concise and put technical details in the log.
- Primary file: `src/extension.ts`.

Done when common error paths use consistent actions and wording.

### ERR-02: Improve compiler startup errors

Status: Complete

- Offer Open Settings when the configured Kotlin command cannot start.
- Offer Show Setup Guide for installation help.
- Offer Open Output for technical details.
- Dependency: ERR-01.
- Primary file: `src/extension.ts`.

Done when a missing compiler can be diagnosed and corrected from the notification.

### ERR-03: Improve execution failures

Status: Complete

- Add recovery actions for compiler errors.
- Add recovery actions for timeouts.
- Add appropriate feedback for cancellation.
- Add recovery actions for Gradle failures.
- Add Open Output for unexpected errors.
- Dependencies: ERR-01 and LOG-02.
- Primary file: `src/extension.ts`.

Done when every terminal failure tells the user what to do next.

### ERR-04: Make automatic fallback visible

Status: Complete

- Notify the user when Gradle resolution fails before local Kotlin is used.
- Avoid presenting a classpath-resolution problem as only a Kotlin source error.
- Dependencies: ERR-01 and LOG-04.
- Primary file: `src/extension.ts`.

Done when learners can distinguish setup failures from source-code failures.

## Phase 4: Environment Check

### ENV-01: Implement environment inspection

Status: Complete

- Check workspace trust.
- Check the configured Kotlin command.
- capture and report the Kotlin version.
- Report the configured execution mode.
- Detect a nearby Gradle project.
- Check Gradle wrapper or executable availability when applicable.
- Add unit tests for available and unavailable tools.
- Primary files: `src/environment.ts` and `test/environment.test.ts`.

Done when environment inspection returns a structured result without running a worksheet.

### ENV-02: Add Check Environment command

Status: Complete

- Contribute `Kotlin Worksheet: Check Environment`.
- Register the command during activation.
- Make it available without requiring an active worksheet when a workspace is open.
- Dependencies: ENV-01 and ERR-01.
- Primary files: `package.json` and `src/extension.ts`.

Done when users can run the check from the Command Palette.

### ENV-03: Present environment results

Status: Complete

- Show a concise success or failure summary.
- Write technical details to the log.
- Offer setup and configuration actions for failed checks.
- Dependencies: ENV-01 and LOG-01.
- Primary file: `src/extension.ts`.

Done when a learner can understand whether the extension is ready to run.

## Phase 5: Status UI

### UI-01: Display execution state

Status: Complete

- Show Ready, Running, Passed, Failed, Cancelled, or Timed Out for the active worksheet.
- Keep the current state synchronized when the active editor changes.
- Dependency: UX-01.
- Primary file: `src/extension.ts`.

Done when the status bar reflects the active worksheet's current or last run.

### UI-02: Expand the status tooltip

Status: Complete

- Include run-on-save state.
- Include requested or resolved execution mode.
- Include last duration and outcome when available.
- Dependency: UI-01.
- Primary file: `src/extension.ts`.

Done when the tooltip answers how and when the worksheet last ran.

### UI-03: Define status-bar interactions

Status: Complete

- Preserve an obvious route to toggle run-on-save.
- Expose cancellation while the active worksheet is running.
- Avoid changing click behavior without reflecting it in the tooltip.
- Dependencies: UI-01 and UX-02.
- Primary file: `src/extension.ts`.

Done when status-bar actions are predictable in every state.

## Phase 6: Editor Reliability

### EDIT-01: Cache decoration results

Status: Complete

- Store formatted decoration options by document URI.
- Reapply cached decorations when an editor becomes visible.
- Primary file: `src/extension.ts`.

Done when decoration results survive editor visibility changes.

### EDIT-02: Clean up document state

Status: Complete

- Remove decoration caches when documents close.
- Remove diagnostics when documents close.
- Dependency: EDIT-01.
- Primary file: `src/extension.ts`.

Done when closed documents leave no stale extension state.

### EDIT-03: Prevent stale diagnostics

Status: Complete

- Clear worksheet diagnostics when the source changes after a run.
- Do not clear unrelated diagnostic collections.
- Primary file: `src/extension.ts`.

Done when Problems never describes an obsolete worksheet version.

### EDIT-04: Make Clear Results comprehensive

Status: Complete

- Clear generated inline comments.
- Clear visible decorations and cached decoration results.
- Clear worksheet diagnostics.
- Dependencies: EDIT-01 and EDIT-03.
- Primary file: `src/extension.ts`.

Done when Clear Results removes all output associated with the active worksheet.

### EDIT-05: Improve render-mode switching

Status: Complete

- Remove generated inline comments when switching to decorations.
- Clear decorations when switching to inline comments.
- Explain when another run is required to materialize inline results.
- Dependency: EDIT-01.
- Primary file: `src/extension.ts`.

Done when switching modes does not leave results from both modes visible.

## Phase 7: Commands and Worksheet Creation

### CMD-01: Resolve the duplicate Rerun command

Status: Complete

- Prefer removing Rerun because it currently duplicates Run.
- Keep it only if it gains distinct behavior such as running the last worksheet.
- Update tests and documentation for the chosen behavior.
- Primary files: `package.json` and `src/extension.ts`.

Done when every exposed command has a distinct purpose.

### CMD-02: Polish command contributions

Status: Complete

- Add suitable ThemeIcon identifiers to contributed commands.
- Add enablement conditions for worksheet-only commands.
- Keep Run and Clear Results in the main editor context menu.
- Move settings toggles out of the modification menu group.
- Primary file: `package.json`.

Done when worksheet menus are concise and unavailable commands are disabled.

### CMD-03: Improve setting metadata

Status: Complete

- Add enum descriptions for render and execution modes.
- Add a stable display order.
- Make descriptions explain learner-visible trade-offs.
- Primary file: `package.json`.

Done when the Settings UI explains each choice without requiring the user guide.

### CMD-04: Fix the run-on-save default inconsistency

Status: Complete

- Change the source fallback to match the declared `false` default.
- Add regression coverage for the effective default.
- Primary file: `src/extension.ts`.

Done when run-on-save is consistently disabled unless explicitly enabled.

### CMD-05: Improve New Worksheet in multi-root workspaces

Status: Complete

- Ask which workspace folder should contain the worksheet when more than one is open.
- Preserve the current automatic filename selection within the chosen folder.
- Handle cancellation without creating a file.
- Primary file: `src/extension.ts`.

Done when New Worksheet never chooses a multi-root destination unexpectedly.

## Phase 8: Onboarding

### ONB-01: Add a native walkthrough

Status: Complete

- Explain how to check the Kotlin environment.
- Provide an action to create a worksheet.
- Explain how to run it.
- Explain inline and decoration results.
- Explain Problems and the Kotlin Worksheet log.
- Dependency: ENV-02.
- Primary file: `package.json` plus walkthrough media if required.

Done when a first-time user can complete one successful worksheet from the walkthrough.

### ONB-02: Connect setup errors to onboarding

Status: Complete

- Let missing-compiler messages open the setup walkthrough or user guide.
- Reuse the same setup content from the environment check.
- Dependencies: ONB-01 and ERR-02.
- Primary file: `src/extension.ts`.

Done when setup errors lead directly to installation guidance.

## Phase 9: Verification

### TEST-01: Test command-level successful execution

Status: Complete

- Invoke the VS Code Run command rather than calling the executor directly.
- Assert result insertion or decoration rendering.
- Assert diagnostics and completion state.
- Primary file: `test/integration/suite/extension.test.ts`.

Done when the complete successful user path is covered in the extension host.

### TEST-02: Test error and recovery paths

Status: Complete

- Cover a missing Kotlin command.
- Cover timeout and cancellation.
- Cover workspace trust.
- Cover Gradle fallback.
- Cover expected log output.
- Primary files: unit and extension-host integration tests.

Done when major failure states and recovery actions have regression coverage.

### TEST-03: Test run-on-save

Status: Complete

- Verify one execution per user save.
- Verify the extension's result save does not trigger another run.
- Verify automatic execution does not use notification progress.
- Primary file: extension-host integration tests.

Done when run-on-save is reliable and non-reentrant.

### TEST-04: Test status transitions

Status: Complete

- Verify Ready, Running, Passed, Failed, and Cancelled transitions.
- Verify state changes when switching active editors.
- Primary file: extension-host integration tests.

Done when status state cannot become stuck after a terminal outcome.

### TEST-05: Test editor lifecycle

Status: Complete

- Cover decoration results in hidden and reopened editors.
- Cover diagnostics after source edits.
- Cover render-mode switching.
- Cover comprehensive Clear Results behavior.
- Primary file: extension-host integration tests.

Done when result and diagnostic state follows the document lifecycle.

### TEST-06: Test multi-root creation

Status: Complete

- Verify folder selection.
- Verify cancellation.
- Verify file creation in the selected folder.
- Primary file: extension-host integration tests.

Done when multi-root worksheet creation is fully covered.

## Phase 10: Documentation and Release

### DOC-01: Update user documentation

Status: Complete

- Document environment checks, progress, status, logs, recovery actions, and `maxResultLength`.
- Update `README.md` and `docs/user-guide.md`.

Done when all new user-facing behavior is documented.

### DOC-02: Correct stale documentation

Status: Complete

- Replace stale 0.3.0 VSIX references.
- Update the architecture description to include Gradle and process execution layers.
- Primary files: `README.md` and `docs/*.md`.

Done when documentation matches the current package and architecture.

### DOC-03: Update release records

Status: Complete

- Add the 0.4.0 changes to `CHANGELOG.md`.
- Update the manual QA checklist in `docs/production-readiness.md`.

Done when release notes and QA cover the complete UX release.

### REL-01: Run release verification

Status: In progress; automated checks and macOS package validation are complete. Cross-platform isolated installation is now enforced in CI, but the workflow and manual visual QA must still pass.

- Run lint, compilation, unit tests, extension-host tests, and package validation.
- Install the VSIX into clean VS Code profiles.
- Smoke-test the release on macOS, Linux, and Windows.

Done when automated checks pass and the clean-profile QA checklist is complete.

## Acceptance Criteria

- A new user can check whether Kotlin Worksheet is ready before running code.
- Every run communicates its current stage and final result.
- Common failures provide a direct recovery action.
- Logs retain useful history without exposing instrumentation markers.
- Run-on-save does not repeatedly interrupt the user.
- Decorations and diagnostics remain accurate as editors and documents change.
- Worksheet commands and settings are understandable without reading source code.
- The full successful flow and major failure paths have extension-host coverage.
