# Maintaining

For whoever merges pull requests and makes releases. How to contribute is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

[Branches](#branches) · [Merging a pull request](#merging-a-pull-request) ·
[Releasing](#releasing) · [GitHub settings](#github-settings)

## Branches

- **`main` is the only long-lived branch.** Releases are tags on it (`v0.1.0`), not branches.
  A fix for an older release is a new release from `main`; there are no maintenance branches
  while the version is 0.x.
- **Contributors** work on a branch in their fork, named after the change (`fix/seam-flip`,
  `feat/fabric-presets`), and open a pull request into `main`.
- **Maintainers** (repository admins) may push straight to `main`: the ruleset lets admins
  bypass it. Anything a second pair of eyes should see still goes through a pull request.
- History on `main` stays linear: squash merges for pull requests, rebase (not merge) for local
  work. Every commit is signed off ([CONTRIBUTING.md](../CONTRIBUTING.md#sign-your-commits-dco)).

## Merging a pull request

What the ruleset ([.github/rulesets/main.json](../.github/rulesets/main.json)) requires:

- CI green: `check` (`make check-ci`: everything in `make check` but the golden drapes, since
  GitHub's runners have no GPU) and `dco` (each commit signed off by its author).
- One approving review, given after the last push; every conversation resolved.
- Squash merge only.

What only a person can check:

- **The drapes.** If the change touches the solver, the mesher, the importer or the shaders,
  run `make regress` on the branch (`gh pr checkout <n>`, or fetch the fork's branch), or check
  that the author did and explained any re-recorded goldens.
- **Patents.** Anything that joins pieces, places them, measures a pattern or resizes a garment
  follows [PATENTS.md](PATENTS.md) (CLAUDE.md, "Patents").
- **Project rules.** WebGPU core only, the engine and the UI separate, published methods cited
  in [ALGORITHMS.md](ALGORITHMS.md), no telemetry (CONTRIBUTING.md, "Rules for engine changes";
  [CLOUD.md](CLOUD.md#privacy)).
- **The squash message.** The title is the PR's title in the history's form
  (`type(scope): summary`); keep the `Signed-off-by:` lines GitHub puts in the body.
- **The changelog.** A line under Unreleased in [CHANGELOG.md](../CHANGELOG.md) when people
  will notice the change.

## Releasing

Versions are [SemVer](https://semver.org/), one version for the whole repository: the Rust
workspace, the web image and the release. While it's 0.x, a minor version (0.2.0) may change
anything, a patch (0.1.1) only fixes. A version with a hyphen (`0.2.0-rc.1`) is a pre-release:
it is published, but `latest` doesn't move.

1. On an up-to-date `main`, with a clean tree:
   - set `version` in `[workspace.package]` of
     [packages/vitryne-engine/Cargo.toml](../packages/vitryne-engine/Cargo.toml), then
     `cd packages/vitryne-engine && cargo check --workspace` to update `Cargo.lock`;
   - in [CHANGELOG.md](../CHANGELOG.md), rename `## [Unreleased]` to `## [0.1.0] - YYYY-MM-DD`,
     add an empty `## [Unreleased]` above it, and update the links at the bottom
     (`[0.1.0]: https://github.com/H4kken/vitryne/releases/tag/v0.1.0`). Check the notes with
     `tools/release/notes.sh 0.1.0`.
2. `make check` (the drapes included, which CI can't run).
3. Commit and tag:

   ```sh
   git commit -s -am "release: 0.1.0"
   git tag -a v0.1.0 -m "Vitryne 0.1.0"
   git push origin main v0.1.0
   ```

4. The tag starts [.github/workflows/release.yml](../.github/workflows/release.yml) (about 20
   minutes; Actions tab). It fails before publishing anything if the tag and `Cargo.toml`
   disagree, or CHANGELOG.md has no section for the version. Then it:
   - runs `make check-ci`, which builds the editor;
   - pushes `ghcr.io/h4kken/vitryne-web:0.1.0`, `:0.1` and `:latest` (linux/amd64 and
     linux/arm64);
   - creates the GitHub release with the changelog section as notes, plus
     `vitryne-web-0.1.0.tar.gz` (the static build), a `docker-compose.yml` that runs 0.1.0,
     `env.example` and `SHA256SUMS`.
5. Update the hosted instance (vitryne.app) to the new image, and check it.

**If the workflow fails** before the image is pushed: fix on `main`, delete the tag
(`git push origin :refs/tags/v0.1.0 && git tag -d v0.1.0`), and tag again. After it is pushed,
don't move the tag: release the fix as the next patch version.

## GitHub settings

Once, on [github.com/H4kken/vitryne](https://github.com/H4kken/vitryne) (they live on GitHub, not
in the repository):

1. **Default branch:** Settings → General → Default branch: `main`. Then delete `master` (an
   ancestor of `main`, so nothing is lost): `git push origin --delete master`.
2. **Pull requests** (Settings → General): allow squash merging only, default message *Pull
   request title and commit details* (keeps the sign-offs); *Always suggest updating pull
   request branches*; *Automatically delete head branches*.
3. **Rulesets** (Settings → Rules → Rulesets → New ruleset → Import a ruleset): import
   [.github/rulesets/main.json](../.github/rulesets/main.json) and
   [.github/rulesets/release-tags.json](../.github/rulesets/release-tags.json) (only admins
   create, move or delete `v*` tags). The status checks `check` and `dco` can only be picked
   once CI has run once, so push the workflows first.
4. **Actions** (Settings → Actions → General): *Require approval for first-time contributors*
   (the default), so a stranger's pull request doesn't run until someone has read it.
5. **Security** (Settings → Security): turn on *Private vulnerability reporting*
   ([SECURITY.md](../SECURITY.md)) and Dependabot alerts.
6. **After the first release:** the image's package (Profile → Packages → `vitryne-web` →
   Package settings) starts private: make it public, and check it is linked to the repository.
