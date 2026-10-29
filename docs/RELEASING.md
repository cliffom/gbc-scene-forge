# Building and releasing

Development and release builds use Python 3.13 and Make. The installed package
supports Python 3.10+. Node 24 (24.12+) and npm compile
the TypeScript frontend and run its tests; the installed editor needs no Node.
Install Poetry 2.4–2.x on `PATH` before running setup; CI installs Poetry 2.4.2
with pip. Development dependencies are locked in `poetry.lock` and
`package-lock.json`. `make setup` checks required tools and project compatibility,
uses `poetry env use` to create/select `.venv`, installs locked dependencies, and
compiles the frontend. `make check-deps` checks prerequisites without installing.

```sh
make setup PYTHON=python3.13
make lint test
make build
make check-dist
```

`make lint` includes scoped Python mypy checks, ESLint, Prettier, and strict TypeScript checks alongside Ruff.
`make typecheck-python` checks shared primitives, file helpers and saved-read contracts;
see [backend architecture](ARCHITECTURE.md) for the scope and native-payload typing policy.
Use `make format` to apply formatting, and `make typecheck` for a standalone type check.

`make build` runs strict TypeScript checking, bundles the supported `frontend/project.ts` and the historical
`frontend/app.ts` fixture entry with esbuild, then uses the
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
imports, version consistency, absence of required runtime dependencies (MCP is optional), bundled browser assets,
standalone sample loading, and project create/reopen/export. It is
intentionally excluded from source-test discovery.
The wheel bundles the portable project from `assets/demo/project/`; the source
distribution also retains the editable Aseprite sources, exports, and atlas
manifest in `assets/demo/artwork/`. The installed sample test checks both loading
and restoring that bundled template without external artwork tools.
CI and release workflows perform the same steps with standard venv/pip commands
before accepting artifacts. No command above uploads packages.

CI runs lint, frontend tests, package builds and Chrome acceptance checks once
on Python 3.13 with Node 24. A separate compatibility matrix installs that same
wheel and runs Python tests and installed-package smoke checks on Python 3.10,
3.11, 3.12, 3.13 and 3.14, without installing Node or rebuilding the frontend.
The browser suite can also be run locally; see the README.

## UI build identity

`npm run build` (also used by `make frontend`, `make run`, `make demo` and
`make build`) reads the app version from `pyproject.toml` and embeds it in the
browser bundle and `static/build-info.json`. The server reads that same metadata
to print its version above Project Root at startup. Source-only Python runs
before a frontend build fall back to the Python package version.
By default, `FORGE_BUILD_MODE=development`: the bottom-right
label shows `VERSION-COMMIT`, using `git rev-parse --short=7 HEAD` at build time.
Set `FORGE_BUILD_COMMIT` to a 7–40 character hexadecimal Git commit identifier
when building development assets without a Git checkout. Missing Git metadata
or an invalid commit fails the development build rather than inventing an identity.

Use `FORGE_BUILD_MODE=production make build` for release artifacts; their label
shows only `VERSION`. The publication workflow sets this mode for all its build
steps, including TestPyPI. Ordinary CI and local builds use development mode.
Only `development` and `production` are accepted. These values are build-time
inputs: changing environment variables or Git HEAD after building does not change
the displayed identity. Wheels and source distributions preserve the prebuilt
bundle, so installation and wheel builds from source archives need neither Git
nor Node. Rebuilding that bundle from an archive requires production mode or an
explicit `FORGE_BUILD_COMMIT`.

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

After reviewing and committing a release, create and push an annotated `v0.13.1`
tag (or the matching next version). Run **Publish package** manually against that
tag, selecting `testpypi` first when its trusted publisher is configured. TestPyPI
is currently unconfigured; its 0.1.4 upload failed with `invalid-publisher`. Until
that publisher is set up, validate the built wheel with `make check-dist` and the
Chrome fixture suite, then run the workflow for `pypi`. Verify a fresh PyPI install
with `tests/package_smoke.py` after publication. The workflow rebuilds and
checks the distributions, checks the tag against the package version, then uploads
only those verified artifacts. Pushing a tag alone does not publish.

## Release 0.13.1

Version 0.13.1 adds saved-file browser refresh for MCP and other external writers.
See [release notes](RELEASE-0.13.1.md) and the [user guide](user/external-refresh.md).
Run `make test-mcp test-mcp-browser` with the optional SDK environment as well as
`make lint test build check-dist` and the full browser suite. The MCP browser target
includes real-writer refresh and dirty-edit protection checks. No schema migration
or required runtime dependency is introduced.

## Release 0.13.0

Version 0.13.0 improves blockout annotation readability in the browser and SVG
reviews. See [release notes](RELEASE-0.13.0.md) for the label hierarchy, screenshots,
and review behavior. Existing projects and MCP schemas are unchanged.

## Release 0.12.0

Version 0.12.0 adds the optional local MCP server, revision-guarded native authoring,
blockout previews, diagnostics and portable exports. See [release notes](RELEASE-0.12.0.md)
and [MCP setup and reference](MCP.md). Existing projects retain manifest version 1;
the plain browser installation retains no required runtime dependencies.

Run `make test-mcp test-mcp-browser` with `FORGE_MCP_PYTHON` pointing at an environment
with the optional extra installed. This exercises the real SDK client and browser
workflow, including concurrent saved edits and recoverable browser drafts. Run the
full browser suite before publication, and verify both a plain fresh install and
an install with `[mcp]` after publishing. The first-use browser workflow can use
the installed wheel: `FORGE_TEST_PYTHON="$PWD/build/package-smoke/bin/python" make test-first-use-browser`.

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

## Internal refactors

Domain packages and installed entry point targets are included automatically by
the existing wheel/source build. After moving Python modules, update adapters,
fixtures, examples and maintained documentation together. Verify the plain installed
launcher and its bundled sample/assets, and install the optional SDK into a fresh
wheel environment for MCP tests. Supported imports must not load `legacy` or the
optional SDK during ordinary editor startup.

Behavior-preserving internal cleanup does not require a dedicated version bump.
Keep the package/runtime versions synchronized; the eventual release must choose
an unpublished version before tagging. Do not publish a rebuilt package over an
existing version. The domain reorganization in #58 retains version 0.13.1 pending
a separately requested release; native schemas and user-facing entry points are
unchanged.

The frontend cleanup in #60 also retains 0.13.1 without a dedicated release.
See [frontend architecture](FRONTEND-ARCHITECTURE.md) for entry points and ownership.
After moving frontend modules, rebuild both bundles and verify the supported
source map excludes `frontend/legacy/`. Run the full browser suite, including editor
disposal/remount acceptance, and installed-wheel first-use acceptance.
