# Kotlin Worksheet User Guide

Kotlin Worksheet evaluates `.worksheet.kts` and `.worksheet.kt` files inside VS Code and writes results back as inline comments or decorations.

## Requirements

- VS Code 1.100 or newer
- Kotlin compiler available as `kotlinc`, or configured through `kotlinWorksheet.kotlinCommand`
- Kotlin syntax highlighting is bundled out-of-the-box via standalone TextMate grammars. For language server features like autocomplete and go-to-definition, JetBrains' official Kotlin extension (`jetbrains.kotlin-server`) is recommended.
- A trusted VS Code workspace for execution

Supported Kotlin compiler for the current release line: `kotlinc-jvm 2.4.0`.

## Support Matrix

| Component | Supported baseline |
| --- | --- |
| VS Code | 1.100 or newer |
| Kotlin compiler | `kotlinc-jvm 2.4.0` for the current release line |
| Build tools | Gradle wrapper/executable or Maven (`pom.xml` / `mvnw`) in standard JVM projects |
| Daemon Mode | Persistent warm background JVM worker for ~130–210 ms execution (13–18x speedup) |
| Operating systems | macOS, Linux, and Windows |

Gradle and Maven classpath modes require a standard JVM project. Android, Kotlin Multiplatform, and custom
build layouts remain unsupported. In automatic mode, a build tool
failure falls back to local Kotlin and shows the categorized reason. Explicit
`gradleClasspath` or `mavenClasspath` mode reports an error instead and does not fall back.
Standalone worksheets can also import Maven Central dependencies directly using `@file:DependsOn("group:artifact:version")`.

## Install The Extension

### From Marketplace

1. Open [Kotlin Worksheet on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet).
2. Click `Install`.
3. Reload VS Code if prompted.

### From VSIX

Use this path for unreleased builds or pilot testing.

1. Get the packaged extension file:

   ```text
   kotlin-worksheet-1.0.0.vsix
   ```

2. Open VS Code.
3. Open the Command Palette.
4. Run:

   ```text
   Extensions: Install from VSIX...
   ```

5. Select `kotlin-worksheet-1.0.0.vsix`.
6. Reload VS Code if prompted.

### From Source

For local development or testing:

```sh
pnpm install
pnpm package
```

Then install the generated `kotlin-worksheet-0.7.0.vsix` using `Extensions: Install from VSIX...`.

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

- mise:

  ```sh
  mise use --global kotlin@2.4.0
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
2. Run `Kotlin Worksheet: Check Environment`.
3. Create a file named `demo.worksheet.kts`.
4. Add:

   ```kotlin
   val language = "Kotlin"
   language.uppercase()

   val answer = 40 + 2
   answer
   ```

5. Run `Kotlin Worksheet: Run`.
6. Results appear as inline comments.

## Result Comments

Worksheet results are ordinary generated comments:

```kotlin
val answer = 40 + 2 // => 42
```

You can edit or remove `// => ...` comments manually. On the next worksheet run, the extension removes generated result comments and writes fresh results.

### Result Rules

The worksheet distinguishes static function information, evaluated values, and
runtime output:

| Source | Result |
| --- | --- |
| Function declaration | Source signature, such as `fun foo(x: Int): String` |
| Lambda or same-worksheet function reference | Inferred function type |
| External function reference | Inferred or explicitly declared function type |
| Normal expression | Evaluated value |
| `println(...)` and other side effects | Runtime Output only |

For example:

```kotlin
fun foo(x: Int): String = x.toString()
// => fun foo(x: Int): String

val fooRef = ::foo
// => (Int) -> String

val lambda = { x: Int -> x.toString() }
// => (Int) -> String

val result = lambda(10)
// => 10

println(result)
```

Function declarations are not called automatically. Printed text from the
function body appears in Runtime Output only when the function is called.
If the extension cannot infer an external function reference's type, it shows a
warning in Problems and omits the misleading runtime object result. Add an
explicit function type to display its declared type.
An untyped lambda whose function type cannot be inferred is handled similarly;
explicitly typed values continue to use their declared type or value result.
These warnings are limited to likely function values; ordinary control flow,
side effects, and known property references do not produce analyzer warnings.

### Focused Evaluation

`Kotlin Worksheet: Run Selection` evaluates the complete worksheet statements
intersecting the current selection. `Kotlin Worksheet: Run Current Block`
evaluates the statement under the cursor. Both commands retain preceding
worksheet declarations as execution context and preserve results outside the
executed range.

Use `Kotlin Worksheet: Clear Results` to remove all generated result comments from the active worksheet.

### Inspecting Results & Value Hovers

Hovering over any line with an evaluated worksheet result displays a rich
tooltip with the formatted result.

When a result exceeds `kotlinWorksheet.maxResultLength` (default: 500 characters),
it is truncated with `...` in the editor. You can interact with the full value:

- Click **Inspect Full Output** in the hover tooltip (or run `Kotlin Worksheet: Inspect Result` from the Command Palette or context menu) to open the full output in a side-by-side read-only tab with search and syntax highlighting (pretty-printed JSON for JSON-like values).
- Click **Copy Result** (or run `Kotlin Worksheet: Copy Result`) to copy the full untruncated string directly to the clipboard.

## Manual vs Auto-run

The default mode is manual run. Use `Kotlin Worksheet: Run` when you want to evaluate the worksheet.

To auto-run worksheets after save:

- Click the `Kotlin WS Manual` status bar item while a `.worksheet.kts` or `.worksheet.kt` file is active, or
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

Switching to decorations removes generated inline comments automatically. Switching back to inline comments clears decorations; run the worksheet again to write inline results.

## Execution Feedback

Manual runs show cancellable progress for preparation, execution-mode detection, Gradle classpath resolution, Kotlin execution, and result application. Run-on-save uses quieter status-bar progress.

The worksheet status bar shows Ready, Running, Passed, Failed, Cancelled, or Timed Out. Its tooltip includes run-on-save state, execution mode, and the last duration. Click it while a worksheet is running to cancel; otherwise click it to toggle run-on-save.

Gradle-backed runs cache successful classpath resolutions. The log reports
whether each Gradle classpath lookup was a cache hit, miss, invalidation,
disabled lookup, or shared active request. The first run may still be slow;
unchanged repeated Gradle runs should avoid repeated classpath resolution.

## Logs And Recovery

Run `Kotlin Worksheet: Show Log` to open chronological execution logs. Each run records its worksheet, requested and resolved execution mode, safe invocation summary, duration, exit code, and terminal status. Gradle failures include a category, the failure detail, and recovery guidance.

Failure notifications provide direct actions for settings, setup guidance, Problems, workspace trust, Gradle fallback, and logs. In automatic mode, Gradle fallback is reported instead of happening silently. In explicit `gradleClasspath` mode, the run stops with an error and offers the log and local-Kotlin recovery actions.

Use this recovery table for the common Gradle failure categories:

| Failure category | Recovery |
| --- | --- |
| Missing Gradle command | Install Gradle or add a project wrapper. |
| Missing project | Open the worksheet inside a Gradle project, or use local Kotlin. |
| Dependency resolution | Check repositories, dependency declarations, and network access. |
| Unsupported layout | Use a JVM `sourceSets.main.runtimeClasspath` layout or local Kotlin. |
| Timeout | Increase `kotlinWorksheet.timeoutMs` and inspect Gradle performance. |
| Cancelled | Run the worksheet again if the cancellation was unintentional. |
| Empty/generic failure | Open `Kotlin Worksheet: Show Log` for full Gradle output. |

Use `Kotlin Worksheet: Check Environment` before the first run to check workspace trust, the configured Kotlin command and version, execution mode, and Gradle availability.

## Worksheet Files

Create files ending with:

```text
.worksheet.kts
.worksheet.kt
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

## Evaluation Behavior

Worksheet evaluation runs top to bottom and reports supported top-level values:

| Code | Result behavior |
| --- | --- |
| `val` or `var` with a simple name | Reports the declared value on that line |
| Flat destructuring such as `val (a, b) = pair` | Reports the components as a list |
| Top-level expressions, including multiline expressions and lambdas | Reports the expression value on its first line |
| `println(...)` or `print(...)` | Preserves printed output without adding a `Unit` result |
| `import`, functions, classes, and interfaces | Executes normally without a result marker |

Nested or multiline destructuring declarations may execute correctly but are
not assigned a result marker. Compiler errors are mapped back to the original
worksheet source lines.

## Commands

- `Kotlin Worksheet: Run`: evaluates the active worksheet.
- `Kotlin Worksheet: Clear Results`: removes generated `// => ...` comments.
- `Kotlin Worksheet: New Worksheet`: creates a starter worksheet file.
- `Kotlin Worksheet: Toggle Run On Save`: switches between manual mode and run-on-save mode.
- `Kotlin Worksheet: Toggle Render Mode`: switches between inline comments and decorations.
- `Kotlin Worksheet: Refresh Gradle Classpath`: clears the cached classpath for the active worksheet project.
- `Kotlin Worksheet: Check Environment`: verifies Kotlin, Gradle, execution mode, and workspace trust.
- `Kotlin Worksheet: Show Log`: opens the chronological Kotlin Worksheet log.

## Settings

```json
{
  "kotlinWorksheet.kotlinCommand": "kotlinc",
  "kotlinWorksheet.runOnSave": false,
  "kotlinWorksheet.renderMode": "inlineComments",
  "kotlinWorksheet.executionMode": "auto",
  "kotlinWorksheet.gradleClasspathCache.enabled": true,
  "kotlinWorksheet.timeoutMs": 10000,
  "kotlinWorksheet.maxResultLength": 500
}
```

## Execution Mode

Choose how worksheets are executed:

- `auto`: use Gradle classpath when a standard Gradle project is detected, then fall back to local `kotlinc` with a visible reason if resolution fails
- `localKotlinc`: always use local `kotlinc -script`
- `gradleClasspath`: require a Gradle project and resolve its runtime classpath before running the worksheet; report an error instead of falling back if resolution fails

Set it with:

```json
{
  "kotlinWorksheet.executionMode": "auto"
}
```

Gradle support works best with standard JVM projects that expose `sourceSets.main.runtimeClasspath`.

Use `Kotlin Worksheet: Refresh Gradle Classpath` after generated outputs or
dependency changes when you want to force the next run to resolve Gradle again.
Set `kotlinWorksheet.gradleClasspathCache.enabled` to `false` to disable this
cache for a workspace.

For release validation, run the local Gradle cache benchmark from the repository:

```sh
pnpm benchmark:gradle-cache
```

The benchmark reports first-run `miss`, second-run `hit`, disabled-cache, and
source-change `invalidated` timings. The second unchanged run should avoid the
expensive Gradle resolution work and report `cache: hit`.

## Current Limitations

- Multi-line statements run, but displayed results are attached to the first line of a simple declaration.
- Flat destructuring declarations are displayed as a list result; nested or
  multiline destructuring declarations may not be displayed.
- The extension executes local Kotlin code, so only use worksheets from trusted workspaces.
