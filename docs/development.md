# Development Guide

## Install

```sh
pnpm install
```

## Build

```sh
pnpm compile
```

Compiled extension files are written to `out/`.

## Lint

```sh
pnpm lint
```

## Test

```sh
pnpm test
```

The test suite covers worksheet text handling, output parsing, diagnostic mapping, and the local `kotlinc` executor when `kotlinc` is available.

## Package

```sh
pnpm package
```

This produces:

```text
kotlin-worksheet-0.0.1.vsix
```

CI uploads the generated VSIX as the `kotlin-worksheet-vsix` workflow artifact.

## Full Check

```sh
pnpm check
```

This lints, compiles TypeScript, runs tests, and packages the extension.

## Manual QA

1. Open the project in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. Open or create a `*.worksheet.kts` file.
4. Run `Kotlin Worksheet: Run`.
5. Confirm inline `// => ...` comments appear.
6. Save the worksheet and confirm auto-run works when `kotlinWorksheet.runOnSave` is enabled.

## Adding Gradle Support Later

Keep Gradle support behind a new execution backend. The current CLI backend should remain useful for standalone worksheets and fast smoke tests.
