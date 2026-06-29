# Contributing

## Development Setup

```sh
pnpm install
pnpm lint
pnpm compile
pnpm test
```

The extension expects a local Kotlin compiler for executor tests:

```sh
kotlinc -version
```

## Before Committing

Run:

```sh
pnpm check
```

This lints, compiles TypeScript, runs tests, and packages the extension.

## Commit Style

Use small commits with direct messages, for example:

```text
Add worksheet timeout diagnostics
Document release process
```

## Release Checklist

1. Update `CHANGELOG.md`.
2. Confirm `pnpm check` passes.
3. Install the generated VSIX in a clean VS Code profile.
4. Run a sample `.worksheet.kts` file manually.
5. Tag the release after publishing.
