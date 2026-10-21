<!-- The title becomes the commit on main (squash merge): `type(scope): what changes`, like the
history (`feat(web): …`, `fix(solver): …`, `docs: …`). See CONTRIBUTING.md, "Pull requests". -->

## What and why

<!-- What changes for the person using Vitryne or for the code, and why. Link the issue
(`Fixes #123`). Screenshots or a short clip for anything visible. -->

## Checked

- [ ] Every commit is signed off (`git commit -s`; CI checks it)
- [ ] `make check-ci` passes (CI runs it too)
- [ ] Solver, mesher or importer changed: `make regress` passes on my GPU, or I re-recorded the
      goldens with `make regress-update` and say why in the commit (or: not touched)
- [ ] Joining pieces, placement, measuring or resizing: checked against
      [docs/PATENTS.md](../docs/PATENTS.md) (or: not touched)
- [ ] A line under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md) if people will notice it
