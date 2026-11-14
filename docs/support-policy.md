# Support And Maintenance Policy

This document defines the official support matrix, stability commitments, and maintenance lifecycle for **Kotlin Worksheet** following the **1.0.0** stable release.

---

## 1. Supported Environment Matrix

### Continuous Integration (CI) Test Baseline
The following exact matrix is automatically built, linted, tested, and packaged across all commits and pull requests via GitHub Actions:

| Component | CI Runner / Environment | Test Execution Notes |
| :--- | :--- | :--- |
| **Operating Systems** | • `macos-latest` (macOS Apple Silicon)<br>• `ubuntu-latest` (Ubuntu Linux x64)<br>• `windows-latest` (Windows Server x64) | Full unit tests, VSIX packaging, isolated installation, and Electron integration suite on all 3 OS runners. |
| **Java Runtime** | Eclipse Temurin OpenJDK 21 LTS | Configured via `actions/setup-java@v4` on all runners. |
| **Kotlin Compiler** | JetBrains Kotlin CLI 2.4.0 | Configured with `kotlinc-jvm 2.4.0` in CI PATH. |
| **Node.js & Tooling** | Node.js 22 LTS with pnpm 10.33.2 | Tested with frozen lockfile. |
| **Build Tools** | Gradle 8.10.2 & Maven 3.8+ | Verified with Maven Central dependency resolution and multi-project classpath caching. |
| **Editor Host** | VS Code Extension Test Host (`@vscode/test-electron`) | Verified with 23 headless integration tests in VS Code runtime. |

### Compatibility Target Scope
Beyond the automated CI baseline, Kotlin Worksheet is engineered and maintained to operate across the following compatible versions:

- **Java Runtimes**: JDK 17 LTS, JDK 21 LTS, JDK 25.
- **Kotlin Compilers**: Kotlin 1.9.x through Kotlin 2.4.x+ (both legacy and K2 compiler frontends).
- **Build Tools**: Standard JVM Gradle projects (7.x, 8.x) and Maven projects (`pom.xml` / `mvnw` 3.8+).
- **Distributions & Editors**: VS Code 1.100+, VSCodium 1.100+, and Cursor (via Visual Studio Marketplace and Open VSX Registry).

---

## 2. Semantic Versioning Commitment

Starting with **v1.0.0**, Kotlin Worksheet strictly adheres to [Semantic Versioning 2.0.0](https://semver.org/):

- **Patch Releases (`1.0.x`)**:
  - Bug fixes, parser optimizations, performance enhancements, and documentation corrections.
  - No breaking configuration changes or command deprecations.
- **Minor Releases (`1.x.0`)**:
  - Backward-compatible new features, new settings options with safe defaults, and support for upcoming Kotlin language specifications.
  - Existing settings keys and command IDs are preserved.
- **Major Releases (`2.0.0`)**:
  - Breaking changes to public configuration properties, removed commands, or dropped support for obsolete runtime environments.
  - Any breaking change will be announced with a minimum 6-month deprecation notice in previous minor releases.

---

## 3. Public API & Configuration Freeze

All public command IDs and configuration properties contributed in `package.json` are frozen:

### Frozen Command IDs
- `kotlinWorksheet.run`
- `kotlinWorksheet.runSelection`
- `kotlinWorksheet.runCurrentBlock`
- `kotlinWorksheet.clearResults`
- `kotlinWorksheet.newWorksheet`
- `kotlinWorksheet.newWorksheetFromTemplate`
- `kotlinWorksheet.exportToKotlin`
- `kotlinWorksheet.exportToTest`
- `kotlinWorksheet.toggleRunOnSave`
- `kotlinWorksheet.toggleRenderMode`
- `kotlinWorksheet.refreshGradleClasspath`
- `kotlinWorksheet.refreshMavenClasspath`
- `kotlinWorksheet.restartDaemon`
- `kotlinWorksheet.checkEnvironment`
- `kotlinWorksheet.showOutput`
- `kotlinWorksheet.inspectResult`
- `kotlinWorksheet.copyResult`

### Frozen Configuration Keys
- `kotlinWorksheet.kotlinCommand`
- `kotlinWorksheet.executionMode` (`"auto"`, `"localKotlinc"`, `"gradleClasspath"`, `"mavenClasspath"`)
- `kotlinWorksheet.daemon.enabled`
- `kotlinWorksheet.runOnSave`
- `kotlinWorksheet.renderMode` (`"inlineComments"`, `"decorations"`)
- `kotlinWorksheet.gradleClasspathCache.enabled`
- `kotlinWorksheet.mavenClasspathCache.enabled`
- `kotlinWorksheet.timeoutMs`
- `kotlinWorksheet.maxResultLength`

---

## 4. Maintenance Lifecycle

- **Active Maintenance**: Releases containing bug fixes and security patches are published promptly.
- **Issue Triage**: Issues reported via [GitHub Issues](https://github.com/toptoppy/kotlin-worksheet-vscode-extension/issues) are reviewed and triaged against the support matrix.
- **Diagnostics**: When reporting issues, users should provide the diagnostic log output from **`Kotlin Worksheet: Show Log`** and include their environment details (`kotlinc -version`, `java -version`, OS).
