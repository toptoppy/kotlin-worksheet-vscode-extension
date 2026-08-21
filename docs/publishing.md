# Publishing And Maintenance

This guide covers publishing Kotlin Worksheet to the Visual Studio Marketplace, updating versions, and maintaining releases.

Examples in this guide target the current `0.7.0` release candidate. Replace
`0.7.0` consistently when preparing a later version; historical `0.6.0`
release material should not be reused for the current release.

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

## Manual GitHub Actions Publishing

Marketplace publishing is intentionally manual. Configure the repository before
the first release:

1. Create a GitHub environment named `marketplace`.
2. Add required reviewers to that environment so publishing requires approval.
3. Add an encrypted environment secret named `VSCE_PAT` containing the
   Marketplace publishing token.
4. Push the version-matching tag `v0.7.0` after the release commit has
   passed normal CI.
5. Open **Actions > Publish Extension > Run workflow** and enter `0.7.0`.

The workflow checks out `v0.7.0`, verifies that `package.json` contains
`0.7.0`, runs the Kotlin and Gradle checks, runs integration tests, and uploads
the checked VSIX as an artifact. Only then does the protected `marketplace`
environment allow the publish job to run. The exact checked VSIX is published
and attached to the GitHub release.

The workflow never creates tags and never runs for ordinary branch pushes.

## Release Version Rules

Use semantic versioning in `package.json`.

- Patch: bug fixes, documentation updates that should appear on Marketplace, small maintenance changes.
- Minor: user-visible features that are backward compatible.
- Major: breaking behavior, command, setting, or compatibility changes.

Marketplace does not allow publishing the same version twice. Every Marketplace update needs a new version.

## Safe Manual Release Flow

Use this flow only after the target version's features are implemented and
cross-platform CI is green. Updating the version prepares a release; it does
not mean the release is ready to publish.

1. Start from a clean, updated `main` branch:

   ```sh
   git pull
   git status
   ```

2. Choose the next version.

   Example:

   ```text
    <previous-version> -> 0.7.0
   ```

3. Update `package.json`:

   ```json
    "version": "0.7.0"
   ```

4. Move `CHANGELOG.md` entries from `Unreleased` into the new version section:

   ```md
    ## [0.7.0] - YYYY-MM-DD
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
    git commit -m "Release 0.7.0"
   ```

8. Create and push the matching release tag:

   ```sh
    git tag v0.7.0
    git push origin main v0.7.0
   ```

9. Confirm the tagged commit passes the normal CI matrix before publishing.

10. Open **Actions > Publish Extension > Run workflow** and enter `0.7.0`.
    Approve the protected `marketplace` environment when the validation job
    passes. This publishes the exact checked VSIX and creates or updates the
    GitHub release.

11. Verify the Marketplace page and GitHub release metadata show the new version:

   ```text
    https://marketplace.visualstudio.com/items?itemName=ws-kts-toppy.kotlin-worksheet
   ```

The standard `0.7.0` release does not use a direct `vsce publish` command; the
protected GitHub Actions workflow owns Marketplace publication.

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
pnpm exec vsce publish --pre-release --packagePath kotlin-worksheet-0.7.0.vsix
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
