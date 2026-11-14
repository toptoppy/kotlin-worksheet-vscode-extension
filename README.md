# Kotlin Worksheet

Evaluate Kotlin worksheet files in VS Code, VSCodium, and Cursor.

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/ws-kts-toppy.kotlin-worksheet?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet)
[![Open VSX](https://img.shields.io/open-vsx/v/ws-kts-toppy/kotlin-worksheet?label=Open%20VSX)](https://open-vsx.org/extension/ws-kts-toppy/kotlin-worksheet)

Files ending in `.worksheet.kts` or `.worksheet.kt` can be run with `Kotlin Worksheet: Run`. Use
`Run Selection` or `Run Current Block` to evaluate focused code without
disturbing unrelated results. Hover over any evaluated expression to preview
its result, inspect large/truncated outputs in a side-by-side tab, or copy the
result to the clipboard. Run-on-save is available as an optional setting.
A persistent compiler daemon ensures warm runs execute interactively in milliseconds (~130–210 ms median latency, up to 18x faster than cold runs).
Standalone worksheets can dynamically pull dependencies from Maven Central via `@file:DependsOn`.

```kotlin
val x = 40 // => 40
x + 2 // => 42
println("hello") // => hello
```

## Requirements

- VS Code, VSCodium, or Cursor (1.100 or newer)
- A local Kotlin compiler on PATH, or configure `kotlinWorksheet.kotlinCommand`
- Kotlin syntax highlighting is bundled out-of-the-box. For language server features like autocomplete and go-to-definition, the official JetBrains Kotlin extension (`jetbrains.kotlin-server`) is recommended.

Supported Kotlin compiler for CI and local examples: `kotlinc-jvm 2.4.0`.
Use `kotlinWorksheet.executionMode` to choose between local `kotlinc`, Gradle or Maven classpath resolution, or automatic detection.
Gradle and Maven-backed runs cache successful classpath resolutions and reuse them until build files or project sources change.
The persistent compiler daemon (`kotlinWorksheet.daemon.enabled`) keeps a warm JVM compiler worker alive for instant sub-second evaluations.
See the official [Support Matrix](#support-matrix) and [Support Policy](docs/support-policy.md) for full compatibility details.

## Support Matrix

| Target | CI Verified Baseline | Compatibility Scope |
| :--- | :--- | :--- |
| **Operating Systems** | macOS (`macos-latest`), Ubuntu (`ubuntu-latest`), Windows (`windows-latest`) | macOS (Apple Silicon & Intel), Linux (x64), Windows 10/11 (x64) |
| **Editors** | VS Code Extension Test Host | VS Code 1.100+, VSCodium, Cursor |
| **Java Runtimes** | Eclipse Temurin OpenJDK 21 LTS | JDK 17 LTS, JDK 21 LTS, JDK 25 |
| **Kotlin Compilers** | `kotlinc-jvm 2.4.0` | Kotlin 1.9.x through 2.4.x+ (legacy & K2 frontends) |
| **Build Tools** | Gradle 8.10.2 & Maven 3.8+ | Standard JVM Gradle 7.x/8.x & Maven 3.8+ |

## Set Up Kotlin

Check whether the Kotlin compiler is available on your PATH:

```sh
kotlinc -version
```

Expected output:
```text
info: kotlinc-jvm 2.4.0 (JRE 21.0.6+7-LTS)
```

If the command is unavailable, install Kotlin using one of these options:

```sh
# macOS with Homebrew
brew install kotlin

# SDKMAN!
sdk install kotlin

# mise
mise use --global kotlin@2.4.0
```

After installing, restart VS Code so the extension detects the updated PATH. If `kotlinc` is installed in a custom location, locate the binary with `which kotlinc` (e.g. `~/.sdkman/candidates/kotlin/current/bin/kotlinc`) and set its path in VS Code settings:

```json
{
  "kotlinWorksheet.kotlinCommand": "/absolute/path/to/kotlinc"
}
```

## Install For Users

Install from the Visual Studio Marketplace:

1. Open [Kotlin Worksheet on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
2. Click `Install`.
3. Open a trusted workspace in VS Code.
4. Create a file ending in `.worksheet.kts` or `.worksheet.kt`.
5. Run `Kotlin Worksheet: Run`.

Install from a local VSIX if you are testing an unreleased build:

1. Download or build `kotlin-worksheet-1.0.0.vsix`.
2. Open VS Code.
3. Run `Extensions: Install from VSIX...` from the Command Palette.
4. Select `kotlin-worksheet-1.0.0.vsix`.
5. Open a trusted workspace.
6. Create a file ending in `.worksheet.kts` or `.worksheet.kt`.
7. Run `Kotlin Worksheet: Run`.

Install the Kotlin compiler if `kotlinc -version` does not work in your terminal. After installing Kotlin, restart VS Code so the extension can see the updated PATH.

## Commands

- `Kotlin Worksheet: Run`
- `Kotlin Worksheet: Run Selection`
- `Kotlin Worksheet: Run Current Block`
- `Kotlin Worksheet: Clear Results`
- `Kotlin Worksheet: Inspect Result`
- `Kotlin Worksheet: Copy Result`
- `Kotlin Worksheet: New Worksheet`
- `Kotlin Worksheet: New Worksheet From Template...`
- `Kotlin Worksheet: Export to Kotlin File`
- `Kotlin Worksheet: Export to Test File`
- `Kotlin Worksheet: Toggle Run On Save`
- `Kotlin Worksheet: Toggle Render Mode`
- `Kotlin Worksheet: Refresh Gradle Classpath`
- `Kotlin Worksheet: Refresh Maven Classpath`
- `Kotlin Worksheet: Restart Kotlin Daemon`
- `Kotlin Worksheet: Check Environment`
- `Kotlin Worksheet: Show Log`

## Settings

- `kotlinWorksheet.kotlinCommand`: command used to run Kotlin scripts, default `kotlinc`
- `kotlinWorksheet.executionMode`: choose `auto`, `localKotlinc`, `gradleClasspath`, or `mavenClasspath`, default `auto`
- `kotlinWorksheet.daemon.enabled`: keep a warm compiler daemon running in the background for sub-second runs, default `true`
- `kotlinWorksheet.runOnSave`: run `.worksheet.kts` or `.worksheet.kt` files on save, default `false`
- `kotlinWorksheet.renderMode`: show results as `inlineComments` or `decorations`, default `inlineComments`
- `kotlinWorksheet.gradleClasspathCache.enabled`: cache successful Gradle classpath resolutions, default `true`
- `kotlinWorksheet.mavenClasspathCache.enabled`: cache successful Maven classpath resolutions, default `true`
- `kotlinWorksheet.timeoutMs`: execution timeout in milliseconds, default `10000`
- `kotlinWorksheet.maxResultLength`: maximum displayed result length, default `500`

## Performance

The first Gradle or Maven-backed run may be slower because the build tool must resolve and
compile the project classpath. Repeated unchanged runs reuse the cached
classpath and log whether the cache was a hit, miss, invalidation, or shared
active request. Use `Kotlin Worksheet: Refresh Gradle Classpath` or `Refresh Maven Classpath`
after changing dependencies or build files.

With the persistent daemon enabled (`kotlinWorksheet.daemon.enabled: true`), warm
worksheet executions run in ~130–210 milliseconds without the repeated JVM spin-up overhead (13–18x speedup).

For the fastest simple worksheets, use `kotlinWorksheet.executionMode` set to
`localKotlinc`, `kotlinWorksheet.renderMode` set to `decorations`, and run
focused code with `Run Selection` or `Run Current Block`.

## Support

If Kotlin Worksheet is useful to you, you can support its development on [Buy Me a Coffee](https://buymeacoffee.com/toptoppy).

## Development

```sh
pnpm install
pnpm compile
pnpm test
```

Run the full local verification before packaging or release:

```sh
pnpm check
```

## Docs

- `docs/user-guide.md`
- `docs/examples.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/publishing.md`
- `docs/production-readiness.md`
- `docs/roadmap-to-1.0.0.md`
- `docs/roadmap-0.5.0.md`
- `docs/ux-confidence-release.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
