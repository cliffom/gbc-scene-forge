# Building and releasing

Python 3.10+ and Make are required. The commands below select Python 3.12;
set `PYTHON` to another supported interpreter if needed. Node 24 runs the browser-model tests; the
editor itself needs no Node installation. Development dependencies are locked in
`poetry.lock`; `make setup` bootstraps Poetry 2.4.2 into `.tools/poetry` and installs
the development environment into `.venv`.

```sh
make setup PYTHON=python3.12
make lint test
make build
```

`make build` uses the standard isolated Python build frontend: it creates the
source distribution, then builds the wheel from that source distribution. It
checks metadata with Twine, installs the wheel without dependencies into a clean
environment, verifies bundled browser files and runs the Python contracts against
that installed wheel. Artifacts appear in `dist/`. Use `make clean` before building
a different version. No command above uploads packages.

CI runs these checks on Python 3.10, 3.12 and 3.14. The independent browser
acceptance check is optional and requires Chrome; see the README.

## Publication

The package is not published yet. Before a first release, choose and record the
project's license and confirm the package name is available on the intended index.
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

After reviewing and committing a release, create and push an annotated `v0.1.0`
tag (or the matching next version). Run **Publish package** manually against that
tag, selecting `testpypi` first. Check that installation and the host connector
work before manually running the workflow for `pypi`. The workflow rebuilds and
checks the distributions, checks the tag against the package version, then uploads
only those verified artifacts. Pushing a tag alone does not publish.

Once a real release is available, consumers can pin `gbc-scene-forge==0.1.0`.
Until then, Settlement uses a sibling editable path dependency, so clone both
repositories beside one another. Its CI also checks out the sibling repository;
it needs this repository's initial commit pushed before it can run successfully.
