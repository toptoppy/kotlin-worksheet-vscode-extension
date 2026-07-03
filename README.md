# Kotlin Worksheet

Evaluate Kotlin worksheet files in VS Code.

[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet)

Files ending in `.worksheet.kts` can be run with `Kotlin Worksheet: Run`. By default, worksheet files also run when saved.

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

## Install For Users

Install from the Visual Studio Marketplace:

1. Open [Kotlin Worksheet on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
2. Click `Install`.
3. Open a trusted workspace in VS Code.
4. Create a file ending in `.worksheet.kts`.
5. Run `Kotlin Worksheet: Run`.

Install from a local VSIX if you are testing an unreleased build:

1. Download or build `kotlin-worksheet-0.3.0.vsix`.
2. Open VS Code.
3. Run `Extensions: Install from VSIX...` from the Command Palette.
4. Select `kotlin-worksheet-0.3.0.vsix`.
5. Open a trusted workspace.
6. Create a file ending in `.worksheet.kts`.
7. Run `Kotlin Worksheet: Run`.

Install the Kotlin compiler if `kotlinc -version` does not work in your terminal. After installing Kotlin, restart VS Code so the extension can see the updated PATH.

## Commands

- `Kotlin Worksheet: Run`
- `Kotlin Worksheet: Rerun`
- `Kotlin Worksheet: Clear Results`
- `Kotlin Worksheet: New Worksheet`
- `Kotlin Worksheet: Toggle Run On Save`
- `Kotlin Worksheet: Toggle Render Mode`

## Settings

- `kotlinWorksheet.kotlinCommand`: command used to run Kotlin scripts, default `kotlinc`
- `kotlinWorksheet.runOnSave`: run `.worksheet.kts` files on save, default `false`
- `kotlinWorksheet.renderMode`: show results as `inlineComments` or `decorations`, default `inlineComments`
- `kotlinWorksheet.executionMode`: choose `auto`, `localKotlinc`, or `gradleClasspath`, default `auto`
- `kotlinWorksheet.timeoutMs`: execution timeout in milliseconds, default `10000`

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
- `docs/architecture.md`
- `docs/development.md`
- `docs/production-readiness.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
