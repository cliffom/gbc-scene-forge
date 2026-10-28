# Repository Guidelines

## Project Structure & Module Organization

`src/gbc_scene_forge/` contains the Python package: connector contracts, HTTP service, document storage, Apply orchestration, progress tracking, and durable transactions. Browser HTML, CSS, and generated JavaScript live in `src/gbc_scene_forge/static/`; editable TypeScript lives in `frontend/`. `tests/` contains Python contracts, TypeScript model checks, an independent fixture connector, Chrome acceptance checks, and a separate installed-package smoke test. `docs/RELEASING.md` documents releases.

## Build, Test, and Development Commands

Install Python 3.10+, Poetry 2.4–2.x, Node 24.12+, npm, and Make on `PATH`.

- `make check-deps`: check installed tools and Poetry/project compatibility.
- `make setup PYTHON=python3.12`: use Poetry to manage `.venv`, install locked dependencies, and bundle the frontend.
- `make lint`: run Ruff, ESLint, Prettier, and strict TypeScript checks.
- `make test`: run Python `unittest` discovery and TypeScript model/API/build checks.
- `make build`: bundle the frontend, build source/wheel distributions, and check metadata.
- `make check-dist`: install the built wheel in a fresh environment and run `tests/package_smoke.py`.
- `.venv/bin/python tests/serve_fixture.py --root /tmp/forge-fixture --port 8777`: launch a disposable local editor fixture.
- `npm run test:browser -- http://127.0.0.1:8777/`: exercise the running fixture with local Chrome.

## Coding Style & Naming Conventions

Use four-space Python indentation, `snake_case` functions/modules, and `PascalCase` classes. Ruff targets Python 3.10, uses a 100-character line length, and checks import ordering. `make format` applies Ruff and Prettier. TypeScript uses strict checking, two-space indentation, single quotes, semicolons, `camelCase` identifiers, and ES modules. Keep runtime Python dependencies absent unless a change explicitly requires them.

## Testing Guidelines

Name Python test files `test_*.py` and methods `test_*`; use standard-library `unittest`. Add regression coverage for changed behavior using `tests/fixture_connector.py`, keeping tests independent of host games. Cover relevant persistence, revision conflicts, Apply/Undo, and recovery behavior. No numeric coverage threshold is configured. Run `make lint test` before submitting; run `make build` for packaging changes and Chrome acceptance checks for browser interactions.

## Commit & Pull Request Guidelines

Existing commits use short, imperative subjects such as “Preserve original scenes on first draft save.” Follow that style. Pull requests should explain the behavior change, link relevant issues, report validation commands/results, and include screenshots for visible UI changes.

## Architecture & Safety Boundaries

Forge owns generic rendering, atlas import, project storage, and Tiled serialization for standalone projects. Game-specific rendering, asset decoding, validation, and builds stay in explicitly supplied connectors. Preserve connector v1 compatibility, loopback binding, mutation-token checks, declared workspace paths, reviewed Apply, and conflict-aware recovery. Never introduce game-specific branches into the reusable editor.
