# Release 1.0 Action Plan & Certification Record

Assessment & Certification Date: 2026-11-17. Decision: **Release 1.0 Certified & Published**.

## 1. Remote Release State & Artifact Publication

- **GitHub Release**: [Kotlin Worksheet 1.0.0 (v1.0.0)](https://github.com/toptoppy/kotlin-worksheet-vscode-extension/releases/tag/v1.0.0)
  - Release Artifact: `kotlin-worksheet-1.0.0.vsix` (146.03 KiB, SHA-256: `af16cccd9dfb73a7c1db9cd84100c...`) attached to release.
- **CI Test Suite**: [Workflow Run #44058583445](https://github.com/toptoppy/kotlin-worksheet-vscode-extension/actions/runs/44058583445)
  - `check (ubuntu-latest)`: Passed (2m 40s)
  - `check (windows-latest)`: Passed (2m 43s)
  - `check (macos-latest)`: Passed (4m 24s)
  - `integration`: Passed (2m 29s)
- **Publish Pipeline**: [Workflow Run #44058810383](https://github.com/toptoppy/kotlin-worksheet-vscode-extension/actions/runs/44058810383)
  - `Validate release`: Passed (2m 53s)
  - `Publish to Visual Studio Marketplace`: Succeeded (27s)
- **Registries**:
  - Visual Studio Marketplace: Published [ws-kts-toppy.kotlin-worksheet v1.0.0](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
  - Open VSX: Configured in `.github/workflows/publish.yml` with `npx --yes ovsx publish` contingent on the `OVSX_PAT` secret (see [docs/publishing.md](file:///Users/toptoppy/projects/vscode-extension/docs/publishing.md)).

## 2. Issue Tracker Triage

- GitHub Issues: `gh issue list --state open` confirmed **0 open issues**.
- GitHub Pull Requests: `gh pr list --state open` confirmed **0 open pull requests**.
- Zero crash reports, zero incorrect result reports, zero data-loss defects, and zero installation blockers.

## 3. Support Scope & Matrix Reconciliation

- [README.md](file:///Users/toptoppy/projects/vscode-extension/README.md) and [docs/support-policy.md](file:///Users/toptoppy/projects/vscode-extension/docs/support-policy.md) explicitly distinguish:
  - **CI-Verified Test Baseline**: macOS (darwin arm64), Ubuntu (Linux x64), Windows (win32 x64); Temurin JDK 21 LTS, Kotlin 2.4.0 CLI, Node 22, Gradle 8.10.2, and VS Code 1.146.0 test host.
  - **Compatibility Target Scope**: JDK 17+, Kotlin 1.9+, Gradle 7+, Maven 3.8+, VSCodium, Cursor.

## 4. Documentation Cleanup & Performance Promises

- Removed malformed Kotlin setup fragment in `README.md`.
- Updated warm daemon latency claims across `README.md`, `CHANGELOG.md`, `docs/user-guide.md`, and `docs/roadmap-to-1.0.0.md` to reflect measured empirical warm medians (**~130–210 ms**, up to **18–23x faster** than cold start) rather than inaccurate sub-100ms promises.
- Hardened benchmark runner at [test/benchmark/daemon-latency.mjs](file:///Users/toptoppy/projects/vscode-extension/test/benchmark/daemon-latency.mjs) (`pnpm benchmark:daemon`) to fail immediately upon any execution or compilation error.

## 5. Later Releases (Post-1.0 Roadmap)

- Broader Gradle layouts, Android, and Kotlin Multiplatform support.
- Notebook-style cell UI.
- Deeper coexistence with Kotlin language-server features (completion, navigation, refactoring).

## 6. Exit Decision

**1.0 Verified & Certified**: Remote release artifacts, registry publication, clean CI matrix runs, issue triage, and empirical performance promises are fully verified with proof recorded.
