# Kotlin Worksheet User Guide

Kotlin Worksheet evaluates `.worksheet.kts` files inside VS Code and writes results back as inline comments.

## Requirements

- VS Code 1.100 or newer
- Kotlin compiler available as `kotlinc`, or configured through `kotlinWorksheet.kotlinCommand`
- A trusted VS Code workspace for execution

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
  "kotlinWorksheet.timeoutMs": 10000
}
```

## Current Limitations

- Gradle project classpath integration is not implemented yet.
- Multi-line statements run, but displayed results are attached to the first line of a simple declaration.
- Complex declarations such as destructuring are not displayed as declaration results.
- The extension executes local Kotlin code, so only use worksheets from trusted workspaces.
