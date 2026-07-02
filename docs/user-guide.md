# Kotlin Worksheet User Guide

Kotlin Worksheet evaluates `.worksheet.kts` files inside VS Code and writes results back as inline comments.

## Requirements

- VS Code 1.100 or newer
- Kotlin compiler available as `kotlinc`, or configured through `kotlinWorksheet.kotlinCommand`
- Kotlin language support extension for syntax highlighting. This extension packs `fwcd.kotlin`, but install or enable a Kotlin syntax extension if `.kts` files still appear in one color.
- A trusted VS Code workspace for execution

Supported Kotlin compiler for the current release line: `kotlinc-jvm 2.4.0`.

## Install The Extension

### From Marketplace

1. Open [Kotlin Worksheet on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
2. Click `Install`.
3. Reload VS Code if prompted.

### From VSIX

Use this path for unreleased builds or pilot testing.

1. Get the packaged extension file:

   ```text
   kotlin-worksheet-0.3.0.vsix
   ```

2. Open VS Code.
3. Open the Command Palette.
4. Run:

   ```text
   Extensions: Install from VSIX...
   ```

5. Select `kotlin-worksheet-0.3.0.vsix`.
6. Reload VS Code if prompted.

### From Source

For local development or testing:

```sh
pnpm install
pnpm package
```

Then install the generated `kotlin-worksheet-0.3.0.vsix` using `Extensions: Install from VSIX...`.

## Install Kotlin

The extension runs worksheets through the Kotlin command-line compiler.

Check whether Kotlin is already installed:

```sh
kotlinc -version
```

If that command fails, install Kotlin with one of these methods:

- macOS with Homebrew:

  ```sh
  brew install kotlin
  ```

- SDKMAN:

  ```sh
  sdk install kotlin
  ```

- Manual install:

  Download Kotlin from the official Kotlin command-line compiler distribution and make sure `kotlinc` is on PATH.

After installing Kotlin, restart VS Code so the extension can see the updated PATH.

If your compiler is not named `kotlinc` or is not on PATH, set:

```json
{
  "kotlinWorksheet.kotlinCommand": "/absolute/path/to/kotlinc"
}
```

## Quick Start

1. Open a trusted workspace in VS Code.
2. Create a file named `demo.worksheet.kts`.
3. Add:

   ```kotlin
   val language = "Kotlin"
   language.uppercase()

   val answer = 40 + 2
   answer
   ```

4. Run `Kotlin Worksheet: Run`.
5. Results appear as inline comments.

## Result Comments

Worksheet results are ordinary generated comments:

```kotlin
val answer = 40 + 2 // => 42
```

You can edit or remove `// => ...` comments manually. On the next worksheet run, the extension removes generated result comments and writes fresh results.

Use `Kotlin Worksheet: Clear Results` to remove all generated result comments from the active worksheet.

## Manual vs Auto-run

The default mode is manual run. Use `Kotlin Worksheet: Run` when you want to evaluate the worksheet.

To auto-run worksheets after save:

- Click the `Kotlin WS Manual` status bar item while a `.worksheet.kts` file is active, or
- Run `Kotlin Worksheet: Toggle Run On Save`, or
- Set:

  ```json
  {
    "kotlinWorksheet.runOnSave": true
  }
  ```

If VS Code Auto Save is enabled, keep worksheet auto-run disabled unless you want the worksheet to execute after frequent saves.

## Render Mode

Worksheet results can be shown in two ways:

- `inlineComments`: writes generated `// => ...` comments into the file
- `decorations`: shows results as editor decorations without adding new result comments

Switch modes with `Kotlin Worksheet: Toggle Render Mode`, or set:

```json
{
  "kotlinWorksheet.renderMode": "decorations"
}
```

If you switch from inline comments to decorations, run `Kotlin Worksheet: Clear Results` once to remove old generated comments from the file.

## Worksheet Files

Create files ending with:

```text
.worksheet.kts
```

Example:

```kotlin
val language = "Kotlin"
language.uppercase()

val answer = 40 + 2
answer

println("worksheets run top to bottom")
```

After running the worksheet, results are written as comments:

```kotlin
val language = "Kotlin" // => Kotlin
language.uppercase() // => KOTLIN

val answer = 40 + 2 // => 42
answer // => 42

println("worksheets run top to bottom") // => worksheets run top to bottom
```

## Commands

- `Kotlin Worksheet: Run`: evaluates the active worksheet.
- `Kotlin Worksheet: Rerun`: same execution path as run, surfaced separately in the editor menu.
- `Kotlin Worksheet: Clear Results`: removes generated `// => ...` comments.
- `Kotlin Worksheet: New Worksheet`: creates a starter worksheet file.
- `Kotlin Worksheet: Toggle Run On Save`: switches between manual mode and run-on-save mode.
- `Kotlin Worksheet: Toggle Render Mode`: switches between inline comments and decorations.

## Settings

```json
{
  "kotlinWorksheet.kotlinCommand": "kotlinc",
  "kotlinWorksheet.runOnSave": false,
  "kotlinWorksheet.renderMode": "inlineComments",
  "kotlinWorksheet.executionMode": "auto",
  "kotlinWorksheet.timeoutMs": 10000,
  "kotlinWorksheet.maxResultLength": 500
}
```

## Execution Mode

Choose how worksheets are executed:

- `auto`: use Gradle classpath when a standard Gradle project is detected, otherwise fall back to local `kotlinc`
- `localKotlinc`: always use local `kotlinc -script`
- `gradleClasspath`: require a Gradle project and resolve its runtime classpath before running the worksheet

Set it with:

```json
{
  "kotlinWorksheet.executionMode": "auto"
}
```

Gradle support works best with standard JVM projects that expose `sourceSets.main.runtimeClasspath`.

## Current Limitations

- Multi-line statements run, but displayed results are attached to the first line of a simple declaration.
- Complex declarations such as destructuring are not displayed as declaration results.
- The extension executes local Kotlin code, so only use worksheets from trusted workspaces.
