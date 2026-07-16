# Publishing And Maintenance

This guide covers publishing Kotlin Worksheet to the Visual Studio Marketplace, updating versions, and maintaining releases.

Official reference: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## Extension Identity

The Marketplace identity is defined in `package.json`:

```json
{
  "publisher": "ws-kts-toppy",
  "name": "kotlin-worksheet"
}
```

The published extension ID is:

```text
ws-kts-toppy.kotlin-worksheet
```

Marketplace page:

```text
https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet
```

Do not change `publisher` or `name` unless you intend to create a different Marketplace extension.

## One-time Publisher Login

Use the Microsoft account that owns the `ws-kts-toppy` Marketplace publisher.

```sh
pnpm exec vsce login ws-kts-toppy
```

Paste the Marketplace Personal Access Token when prompted.

For manual publishing, a PAT is acceptable. For long-term automated publishing, plan to move to Microsoft Entra ID authentication because Azure DevOps global PATs are scheduled for retirement on December 1, 2026.

## Release Version Rules

Use semantic versioning in `package.json`.

- Patch: bug fixes, documentation updates that should appear on Marketplace, small maintenance changes.
- Minor: user-visible features that are backward compatible.
- Major: breaking behavior, command, setting, or compatibility changes.

Marketplace does not allow publishing the same version twice. Every Marketplace update needs a new version.

## Safe Manual Release Flow

1. Start from a clean, updated `main` branch:

   ```sh
   git pull
   git status
   ```

2. Choose the next version.

   Example:

   ```text
   0.3.1 -> 0.4.0
   ```

3. Update `package.json`:

   ```json
   "version": "0.4.0"
   ```

4. Move `CHANGELOG.md` entries from `Unreleased` into the new version section:

   ```md
   ## [0.4.0] - YYYY-MM-DD
   ```

5. Run the full release check:

   ```sh
   pnpm check
   ```

   This lints, compiles, tests, and packages the VSIX.

6. Confirm package contents in the `pnpm check` output.

   Expected package shape:

   ```text
   extension/
     assets/icon.png
     docs/
     out/
     package.json
     readme.md
     changelog.md
   ```

7. Commit the release:

   ```sh
   git add package.json CHANGELOG.md
   git commit -m "Release 0.4.0"
   ```

8. Publish the exact VSIX that was checked:

   ```sh
   pnpm exec vsce publish --packagePath kotlin-worksheet-0.4.0.vsix
   ```

9. Tag the release after Marketplace publish succeeds:

   ```sh
   git tag v0.4.0
   git push origin main v0.4.0
   ```

10. Verify the Marketplace page shows the new version:

    ```text
    https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet
    ```

## Auto-version Publish Option

`vsce` can bump the version and publish in one command:

```sh
pnpm exec vsce publish patch
pnpm exec vsce publish minor
pnpm exec vsce publish major
```

Use this only when you are comfortable with `vsce` updating `package.json` and creating the version commit/tag automatically. For this project, the safer default is the manual release flow above because it keeps changelog, CI, and package inspection explicit.

## Publish A Pre-release

Use pre-release publishing when you want early feedback without replacing the stable release channel:

```sh
pnpm exec vsce publish --pre-release --packagePath kotlin-worksheet-0.4.0.vsix
```

Use pre-release builds for pilot customers when Marketplace distribution is easier than sharing a VSIX directly.

## Private Pilot Distribution

For pilot customers who should not use Marketplace yet:

1. Run:

   ```sh
   pnpm check
   ```

2. Share the generated VSIX:

   ```text
   kotlin-worksheet-<version>.vsix
   ```

3. Ask the customer to install it from VS Code:

   ```text
   Extensions: Install from VSIX...
   ```

## Maintenance Checklist

Before each release:

- Keep `package.json` `publisher`, `name`, `icon`, `repository`, `bugs`, and `homepage` correct.
- Keep `README.md` Marketplace install instructions current.
- Keep `CHANGELOG.md` accurate.
- Keep Kotlin CI version and user docs aligned with the supported compiler version.
- Run `pnpm check`.
- Verify the CI workflow passes after pushing.
- Verify the VSIX artifact size stays small.
- Smoke-test the packaged VSIX in a clean VS Code profile when behavior changes.

After each release:

- Confirm Marketplace version and README rendering.
- Confirm install from Marketplace works.
- Watch GitHub issues and Marketplace reviews for regressions.
- Create follow-up issues for bugs or customer feedback.

## Common Problems

### Access Denied During Publish

Check that:

- `package.json` uses `publisher: "ws-kts-toppy"`.
- You logged in with `pnpm exec vsce login ws-kts-toppy`.
- Your Microsoft account is a member or owner of the `ws-kts-toppy` publisher.
- The PAT was created from the same account and has Marketplace manage permissions.

### Version Already Exists

Marketplace versions are immutable. Bump `package.json` to the next patch, minor, or major version and publish again.

### Package Is Too Large

Check `pnpm package` output. The VSIX should not contain local downloads, test fixtures, `node_modules`, build caches, or large source images.

The CI workflow has a VSIX size guard. If it fails, inspect `.vscodeignore` and move temporary downloads to `/tmp`.

### Marketplace README Looks Wrong

Marketplace renders `README.md` from the VSIX. Update `README.md`, bump the version, run `pnpm check`, and publish a patch release.
