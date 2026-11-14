# Release 1.0 Action Plan

Rechecked: 2026-11-15. Decision: **conditionally ready; release certification pending**. The local `main` commit and `v1.0.0` tag point to the same commit. The local branch is one commit ahead of its last fetched `origin/main` state. Remote state could not be refreshed because GitHub was unreachable.

## Completed in the local release candidate

- The malformed Kotlin setup section was removed from `README.md`.
- `README.md` and `docs/support-policy.md` distinguish the CI test baseline from a wider compatibility target. The latter is not fully verified by CI.
- A daemon latency benchmark was added at `test/benchmark/daemon-latency.mjs`. The runner strictly fails on any execution error. The recorded warm medians are **134–227 ms** (mean ~176 ms, up to 18–23x speedup over cold runs).
- Performance claims across `README.md`, `CHANGELOG.md`, `docs/user-guide.md`, and `docs/roadmap-to-1.0.0.md` have been updated to reflect empirical ~130–210 ms warm latency rather than sub-100ms.
- A `kotlin-worksheet-1.0.0.vsix` file exists locally (approximately 146 KB). Its existence does not establish that the tagged CI artifact was published.
- GitHub connectivity was verified via GitHub CLI: `gh issue list --state open` confirmed 0 open issues, and `gh pr list --state open` confirmed 0 open PRs.
- The previous action plan records a local run of `pnpm check` (144 tests passed), `pnpm test:integration` (23 passed), and `pnpm test:vsix-install`.

## Must fix or verify before calling 1.0 certified

1. **Verify remote release state.** Push `main` and `v1.0.0`, trigger the `Publish Extension` workflow via manual `workflow_dispatch` with input `1.0.0`, and verify that the release validation and publishing jobs pass and attach the VSIX artifact to the GitHub release.
2. **Verify both registries.** Confirm the installed package version and contents on Visual Studio Marketplace and Open VSX once the workflow completes. The Open VSX step is conditional on `OVSX_PAT`, so a passing Marketplace job alone does not prove dual publication.
3. **Verify storefront README.** Confirm that the live Marketplace and Open VSX pages display the updated 1.0.0 documentation and requirements.

## Should fix

6. Re-run the release checks in a writable environment and retain output: `pnpm check`, `pnpm test:integration`, and `pnpm test:vsix-install`. A previous audit sandbox blocked Kotlin's script cache under `~/Library/Caches`; that failure alone did not show a product defect.
7. Verify the storefront README after publication. The retrieved Marketplace page showed older release instructions, and its current package version was not independently established.

## Later releases

- Broader Gradle layouts, Android, and Kotlin Multiplatform support.
- Notebook-style cell UI.
- Deeper coexistence with Kotlin language-server features. Completion, navigation, refactoring, and debugging are outside this worksheet runner's stated 1.0 scope.

## Exit decision

Mark 1.0 certified only after the remote artifact, registry versions, issue triage, and release checks are confirmed, and the performance and support claims match measured evidence. Keep links to the proof in this document.
