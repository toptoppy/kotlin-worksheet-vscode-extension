# Kotlin Worksheet User Guide

Kotlin Worksheet evaluates `.worksheet.kts` files inside VS Code and writes results back as inline comments.

## Requirements

- VS Code 1.100 or newer
- Kotlin compiler available as `kotlinc`, or configured through `kotlinWorksheet.kotlinCommand`
- A trusted VS Code workspace for execution

## Install The Extension

### From VSIX

1. Get the packaged extension file:

   ```text
   kotlin-worksheet-0.0.1.vsix
   ```

2. Open VS Code.
3. Open the Command Palette.
4. Run:

   ```text
   Extensions: Install from VSIX...
   ```

5. Select `kotlin-worksheet-0.0.1.vsix`.
6. Reload VS Code if prompted.

### From Source

For local development or testing:

```sh
pnpm install
pnpm package
```

Then install the generated `kotlin-worksheet-0.0.1.vsix` using `Extensions: Install from VSIX...`.

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
- `Kotlin Worksheet: Clear Results`: removes generated `// => ...` comments.
- `Kotlin Worksheet: New Worksheet`: creates a starter worksheet file.

## Settings

```json
{
  "kotlinWorksheet.kotlinCommand": "kotlinc",
  "kotlinWorksheet.runOnSave": true,
  "kotlinWorksheet.timeoutMs": 10000,
  "kotlinWorksheet.maxResultLength": 500
}
```

## Current Limitations

- Gradle project classpath integration is not implemented yet.
- Multi-line statements run, but displayed results are attached to the first line of a simple declaration.
- Complex declarations such as destructuring are not displayed as declaration results.
- The extension executes local Kotlin code, so only use worksheets from trusted workspaces.
