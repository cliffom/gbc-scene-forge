# Repository Guidelines

## Project Structure & Module Organization

`src/gbc_scene_forge/` contains the Python package: connector contracts, HTTP service, document storage, Apply orchestration, progress tracking, and durable transactions. Browser HTML, CSS, and JavaScript live in `src/gbc_scene_forge/static/`. `tests/` contains Python contracts, JavaScript model checks, an independent fixture connector, and optional Chrome acceptance checks. `tools/` provides environment bootstrap and distribution validation; `docs/RELEASING.md` documents releases.

## Build, Test, and Development Commands

Use Python 3.10+; Node 24 runs the JavaScript checks.

- `make setup PYTHON=python3.12`: bootstrap pinned Poetry and install locked dependencies into `.venv`.
- `make lint`: run Ruff linting and formatting checks.
- `make test`: run Python `unittest` discovery and `node tests/model.mjs`.
- `make build`: build source/wheel distributions, check metadata, and validate the installed wheel in a clean environment.
- `.venv/bin/python tests/serve_fixture.py --root /tmp/forge-fixture --port 8777`: launch a disposable local editor fixture.
- `node tests/browser.mjs http://127.0.0.1:8777/`: exercise the running fixture with local Chrome.

## Coding Style & Naming Conventions

Use four-space Python indentation, `snake_case` functions/modules, and `PascalCase` classes. Ruff targets Python 3.10, uses a 100-character line length, and checks import ordering. Format Python with `.tools/poetry/bin/poetry run ruff format .`. Match surrounding JavaScript conventions, including `camelCase` identifiers and ES modules where used. Keep runtime Python dependencies absent unless a change explicitly requires them.

## Testing Guidelines

Name Python test files `test_*.py` and methods `test_*`; use standard-library `unittest`. Add regression coverage for changed behavior using `tests/fixture_connector.py`, keeping tests independent of host games. Cover relevant persistence, revision conflicts, Apply/Undo, and recovery behavior. No numeric coverage threshold is configured. Run `make lint test` before submitting; run `make build` for packaging changes and Chrome acceptance checks for browser interactions.

## Commit & Pull Request Guidelines

Existing commits use short, imperative subjects such as “Preserve original scenes on first draft save.” Follow that style. Pull requests should explain the behavior change, link relevant issues, report validation commands/results, and include screenshots for visible UI changes.

## Architecture & Safety Boundaries

Keep rendering, asset decoding, and game builds in explicitly supplied connectors. Preserve loopback binding, mutation-token checks, declared workspace paths, reviewed Apply, and conflict-aware recovery. Never introduce game-specific branches into the reusable editor.
