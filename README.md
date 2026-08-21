# Kotlin Worksheet

Evaluate Kotlin worksheet files in VS Code.

[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet)

Files ending in `.worksheet.kts` can be run with `Kotlin Worksheet: Run`. Use
`Run Selection` or `Run Current Block` to evaluate focused code without
disturbing unrelated results. Run-on-save is available as an optional setting.

```kotlin
val x = 40 // => 40
x + 2 // => 42
println("hello") // => hello
```

## Requirements

- VS Code 1.100 or newer
- A local Kotlin compiler on PATH, or configure `kotlinWorksheet.kotlinCommand`
- Kotlin syntax highlighting from a Kotlin language extension. This extension packs `fwcd.kotlin`.

Supported Kotlin compiler for CI and local examples: `kotlinc-jvm 2.4.0`.
Use `kotlinWorksheet.executionMode` to choose between local `kotlinc`, Gradle classpath resolution, or automatic detection.
Gradle-backed runs cache successful classpath resolutions and reuse them until Gradle build files or project sources change.
The current support baseline is VS Code 1.100+, Kotlin 2.4.0, and macOS, Linux, or Windows. See the [support matrix](docs/user-guide.md#support-matrix) for Gradle limitations.

## Set Up Kotlin

Check whether the Kotlin compiler is available:

```sh
kotlinc -version
```

If the command is unavailable, install Kotlin with one of these options:

```sh
# macOS with Homebrew
brew install kotlin

# SDKMAN
sdk install kotlin

# mise
mise use --global kotlin@2.4.0
```

Restart VS Code after installing Kotlin so the extension can detect the updated PATH. If `kotlinc` is installed elsewhere, set its path in VS Code settings:

```json
{
  "kotlinWorksheet.kotlinCommand": "/absolute/path/to/kotlinc"
}
```

## Set kotlinc 
- Run `kotlinc -version` and result must be like `info: kotlinc-jvm 2.x.10 (JRE 2x.xxx)`
- (If there is no kotlinc please install by using `sdk install kotlin` then check again
- Run `which kotlinc` and result should be like `${HOME}/.sdkman/candidates/kotlin/current/bin/kotlinc`
- Copy and then paste kotlinc path into "Kotlin Worksheet: Kotlin Command" in plugin setting 

## Install For Users

Install from the Visual Studio Marketplace:

1. Open [Kotlin Worksheet on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
2. Click `Install`.
3. Open a trusted workspace in VS Code.
4. Create a file ending in `.worksheet.kts`.
5. Run `Kotlin Worksheet: Run`.

Install from a local VSIX if you are testing an unreleased build:

1. Download or build `kotlin-worksheet-0.7.0.vsix`.
2. Open VS Code.
3. Run `Extensions: Install from VSIX...` from the Command Palette.
4. Select `kotlin-worksheet-0.7.0.vsix`.
5. Open a trusted workspace.
6. Create a file ending in `.worksheet.kts`.
7. Run `Kotlin Worksheet: Run`.

Install the Kotlin compiler if `kotlinc -version` does not work in your terminal. After installing Kotlin, restart VS Code so the extension can see the updated PATH.

## Commands

- `Kotlin Worksheet: Run`
- `Kotlin Worksheet: Run Selection`
- `Kotlin Worksheet: Run Current Block`
- `Kotlin Worksheet: Clear Results`
- `Kotlin Worksheet: New Worksheet`
- `Kotlin Worksheet: Toggle Run On Save`
- `Kotlin Worksheet: Toggle Render Mode`
- `Kotlin Worksheet: Refresh Gradle Classpath`
- `Kotlin Worksheet: Check Environment`
- `Kotlin Worksheet: Show Log`

## Settings

- `kotlinWorksheet.kotlinCommand`: command used to run Kotlin scripts, default `kotlinc`
- `kotlinWorksheet.runOnSave`: run `.worksheet.kts` files on save, default `false`
- `kotlinWorksheet.renderMode`: show results as `inlineComments` or `decorations`, default `inlineComments`
- `kotlinWorksheet.executionMode`: choose `auto`, `localKotlinc`, or `gradleClasspath`, default `auto`
- `kotlinWorksheet.gradleClasspathCache.enabled`: cache successful Gradle classpath resolutions, default `true`
- `kotlinWorksheet.timeoutMs`: execution timeout in milliseconds, default `10000`
- `kotlinWorksheet.maxResultLength`: maximum displayed result length, default `500`

## Performance

The first Gradle-backed run may still be slow because Gradle must resolve and
compile the project classpath. Repeated unchanged runs reuse the cached
classpath and log whether the cache was a hit, miss, invalidation, or shared
active request. Use `Kotlin Worksheet: Refresh Gradle Classpath` after changing
generated outputs or when you want to force a fresh Gradle classpath.

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
