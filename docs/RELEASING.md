# Building and releasing

Python 3.10+ and Make are required. The commands below select Python 3.12;
set `PYTHON` to another supported interpreter if needed. Node 24.12+ and npm compile
the TypeScript frontend and run its tests; the installed editor needs no Node.
Development dependencies are locked in `poetry.lock` and `package-lock.json`.
`make setup` bootstraps Poetry 2.4.2 into `.tools/poetry`, installs the Python
environment into `.venv`, runs `npm ci`, and compiles the frontend.

```sh
make setup PYTHON=python3.12
make lint test
make build
```

`make lint` includes ESLint, Prettier, and strict TypeScript checks alongside Ruff.
Use `make format` to apply formatting, and `make typecheck` for a standalone type check.

`make build` compiles `frontend/` into Git-ignored browser assets, then uses the
standard isolated Python build frontend: it creates the
source distribution, then builds the wheel from that source distribution. It
checks metadata with Twine, installs the wheel without dependencies into a clean
environment, verifies bundled browser files and runs the Python contracts against
that installed wheel. Artifacts appear in `dist/`. Before building a different
version, run `make clean` followed by `npm ci` to reinstall the frontend dependencies
removed by cleanup. The source archive includes TypeScript sources, frontend
configuration, the npm lockfile, and precompiled assets. Building a wheel from
that archive verifies the asset manifest and uses those assets without running Node.
The PEP 517/660 backend checks assets for direct wheel, source, and editable builds
too: it recompiles stale/missing assets when local tooling is installed and fails
with setup instructions otherwise. `make frontend` stages compiler output and only
publishes after success. Distribution checks also build from a precompiled source
archive without Node and verify that a checkout missing assets cannot silently
produce a wheel. No command above uploads packages.

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

After reviewing and committing a release, create and push an annotated `v0.1.1`
tag (or the matching next version). Run **Publish package** manually against that
tag, selecting `testpypi` first. Check that installation and the host connector
work before manually running the workflow for `pypi`. The workflow rebuilds and
checks the distributions, checks the tag against the package version, then uploads
only those verified artifacts. Pushing a tag alone does not publish.

The current release version is 0.1.1, tagged `v0.1.1`. It adds first-save original
scene snapshots and Open original, including draft-independent restoration and
contextual button availability. The package includes the MIT license, wheel and
source archive. Release checks run 21 Python contracts both from source and
against the installed wheel, plus browser-model checks. The independent Chrome
acceptance check covers Apply/Undo, snapshot persistence across reload and draft
deletion, original restoration controls and unsaved-change confirmation.

After successful publication, consumers can pin `gbc-scene-forge==0.1.1` from
[PyPI](https://pypi.org/project/gbc-scene-forge/0.1.1/). Editable sibling checkouts
remain an option for development.
