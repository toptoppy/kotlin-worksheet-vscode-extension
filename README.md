# Kotlin Worksheet

Evaluate Kotlin worksheet files in VS Code.

Files ending in `.worksheet.kts` can be run with `Kotlin Worksheet: Run`. By default, worksheet files also run when saved.

```kotlin
val x = 40 // => 40
x + 2 // => 42
println("hello") // => hello
```

## Requirements

- VS Code 1.100 or newer
- A local Kotlin compiler on PATH, or configure `kotlinWorksheet.kotlinCommand`

The MVP runs worksheets with `kotlinc -script`, so it does not use a Gradle project classpath yet.

## Commands

- `Kotlin Worksheet: Run`
- `Kotlin Worksheet: Clear Results`
- `Kotlin Worksheet: New Worksheet`

## Settings

- `kotlinWorksheet.kotlinCommand`: command used to run Kotlin scripts, default `kotlinc`
- `kotlinWorksheet.runOnSave`: run `.worksheet.kts` files on save, default `true`
- `kotlinWorksheet.timeoutMs`: execution timeout in milliseconds, default `10000`

## Development

```sh
pnpm install
pnpm compile
pnpm test
```

## Docs

- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
