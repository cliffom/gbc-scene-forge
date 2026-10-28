# Building and releasing

Python 3.10+ and Make are required. The commands below select Python 3.12;
set `PYTHON` to another supported interpreter if needed. Node 24.12+ and npm compile
the TypeScript frontend and run its tests; the installed editor needs no Node.
Install Poetry 2.4–2.x on `PATH` before running setup; CI installs Poetry 2.4.2
with pip. Development dependencies are locked in `poetry.lock` and
`package-lock.json`. `make setup` checks required tools and project compatibility,
uses `poetry env use` to create/select `.venv`, installs locked dependencies, and
compiles the frontend. `make check-deps` checks prerequisites without installing.

```sh
make setup PYTHON=python3.12
make lint test
make build
make check-dist
```

`make lint` includes ESLint, Prettier, and strict TypeScript checks alongside Ruff.
Use `make format` to apply formatting, and `make typecheck` for a standalone type check.

`make build` runs strict TypeScript checking, bundles `frontend/app.ts` and its
imports with esbuild, then uses the
standard isolated Python build frontend: it creates the
source distribution, then builds the wheel from that source distribution and
checks metadata with Twine. Artifacts appear in `dist/`. `make build` and
`make check-dist` select artifacts matching the current package version, so older
local builds do not interfere. `make clean` removes all build outputs and
`node_modules`; run `npm ci` or `make setup` afterward. The source archive includes TypeScript sources, frontend
configuration, the npm lockfile, esbuild dependency metadata, and the prebuilt
bundle and source map. Hatchling is the standard Python build backend; its
declarative file inclusion requires the bundle and map to exist. No custom Python
frontend build hooks are used. Building a wheel from the source archive uses those
assets without Node. Direct Python builds from a checkout must follow
`npm ci` and `npm run build`; use `make build` to rebuild assets automatically.
`make check-dist` is a separate installed-wheel smoke test. It recreates
`build/package-smoke`, installs the wheel with `pip --no-index --no-deps`, and runs
`tests/package_smoke.py` with Python's `-I` isolation flag. The small suite checks
imports, version consistency, absent runtime dependencies, bundled browser assets,
standalone sample loading, and project create/reopen/export. It is
intentionally excluded from source-test discovery.
CI and release workflows perform the same steps with standard venv/pip commands
before accepting artifacts. No command above uploads packages.

CI runs these checks on Python 3.10, 3.12 and 3.14, with Chrome acceptance checks
on Python 3.12. The browser suite can also be run locally; see the README.

## Publication

The project uses the MIT license, included in both distribution formats. Before a
first release, confirm the package name is available on the intended index.
Keep the version in `pyproject.toml` and `src/gbc_scene_forge/__init__.py` in sync;
the installed-wheel check enforces this.

Create GitHub environments `testpypi` and `pypi`. Register a trusted publisher on
each index with:

- Owner: `cliffom`
- Repository: `gbc-scene-forge`
- Workflow: `publish.yml`
- Environment: `testpypi` or `pypi`, matching the index
- Package name: `gbc-scene-forge`

For a new package, register a pending publisher through the index account's
publishing page. Use the official [trusted publisher setup guide](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).
The workflow follows the [Python Packaging User Guide](https://packaging.python.org/en/latest/guides/publishing-package-distribution-releases-using-github-actions-ci-cd-workflows/)
and uses short-lived OIDC credentials; no PyPI API token is stored in the repository.

After reviewing and committing a release, create and push an annotated `v0.3.0`
tag (or the matching next version). Run **Publish package** manually against that
tag, selecting `testpypi` first when its trusted publisher is configured. TestPyPI
is currently unconfigured; its 0.1.4 upload failed with `invalid-publisher`. Until
that publisher is set up, validate the built wheel with `make check-dist` and the
Chrome fixture suite, then run the workflow for `pypi`. Verify a fresh PyPI install
with `tests/package_smoke.py` after publication. The workflow rebuilds and
checks the distributions, checks the tag against the package version, then uploads
only those verified artifacts. Pushing a tag alone does not publish.

## Release 0.3.0

Version 0.3.0 adds project roots, named project directories, a project selector,
and save-aware workspace switching. It also includes the editable standalone sample
and Make development workflow. Manifest schema remains version 1.
See [release notes and compatibility changes](RELEASE-0.3.0.md).

Before tagging, run:

```sh
make lint test build check-dist
make test-browser
make test-tiled TILED=/path/to/Tiled RASTERIZER=/path/to/tmxrasterizer
```

`make check-dist` installs the current version's wheel explicitly. Keep only the
intended version's artifacts in `dist/` before any manual publication. Review the release
notes, commit the release changes, and use the publication workflow above.
Keep the README installation example and release notes aligned with the tagged version.
Verify a fresh install and the standalone launcher before announcing the release.
Editable sibling checkouts remain an option for development.
