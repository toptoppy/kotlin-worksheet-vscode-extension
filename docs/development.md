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

The current CI and sample workflow are pinned to `kotlinc-jvm 2.4.0`.

The extension now supports inline comments and decoration-based rendering for worksheet results.
Gradle classpath execution is available in `auto`, `localKotlinc`, and `gradleClasspath` modes.

## Package

```sh
pnpm package
```

This produces:

```text
kotlin-worksheet-0.3.0.vsix
```

CI uploads the generated VSIX as the `kotlin-worksheet-vsix` workflow artifact.

To install the generated package in VS Code, run `Extensions: Install from VSIX...` and select `kotlin-worksheet-0.3.0.vsix`.

For Marketplace publishing, version updates, and release maintenance, see `docs/publishing.md`.

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

## Gradle Mode

The Gradle backend resolves the root project classpath automatically when `kotlinWorksheet.executionMode` is `auto` or `gradleClasspath`.

Keep local `kotlinc` mode available for standalone worksheets and fast smoke tests.
