# Repository Guidelines

## Project Structure & Module Organization

`src/gbc_scene_forge/` contains the Python package: standalone project storage, atlas import, Tiled serialization, the loopback HTTP service, and durable transactions. Legacy connector, document, and Apply modules remain in the tree but are not the supported product direction. Browser HTML, CSS, and generated JavaScript live in `src/gbc_scene_forge/static/`; editable TypeScript lives in `frontend/`. `tests/` contains Python project/storage tests, TypeScript model checks, standalone Chrome acceptance checks, Tiled interoperability checks, and a separate installed-package smoke test. It also contains legacy connector fixtures and tests. `docs/RELEASING.md` documents releases.

## Build, Test, and Development Commands

Install Python 3.10+, Poetry 2.4–2.x, Node 24.12+, npm, and Make on `PATH`.

- `make help`: list setup, standalone launch, test and build targets.
- `make run [PROJECT_ROOT=/path]`: rebuild and browse projects (default `.forge_project/`). Use `PROJECT=/path` to open one project directly.
- `make demo`: rebuild and serve a populated standalone sample in `.demo/`, preserving edits.
- `make check-deps`: check installed tools and Poetry/project compatibility.
- `make setup PYTHON=python3.12`: use Poetry to manage `.venv`, install locked dependencies, and bundle the frontend.
- `make lint`: run Ruff, ESLint, Prettier, and strict TypeScript checks.
- `make test`: run Python `unittest` discovery and TypeScript model/API/build checks.
- `make build`: bundle the frontend, build source/wheel distributions, and check metadata.
- `make check-dist`: install the built wheel in a fresh environment and run `tests/package_smoke.py`.
- `.venv/bin/python tests/serve_standalone_fixture.py --root /tmp/forge-fixture --port 8777`: launch a disposable standalone project fixture.
- `make test-browser [CHROME=/path]`: rebuild and exercise standalone workflows with a disposable workspace and Chrome.
- `make check`: run lint, Python/TypeScript tests and standalone Chrome acceptance.
- `make test-tiled TILED=/path RASTERIZER=/path`: run optional official Tiled interoperability checks.

## Coding Style & Naming Conventions

Use four-space Python indentation, `snake_case` functions/modules, and `PascalCase` classes. Ruff targets Python 3.10, uses a 100-character line length, and checks import ordering. `make format` applies Ruff and Prettier. TypeScript uses strict checking, two-space indentation, single quotes, semicolons, `camelCase` identifiers, and ES modules. Keep runtime Python dependencies absent unless a change explicitly requires them.

## Testing Guidelines

Name Python test files `test_*.py` and methods `test_*`; use standard-library `unittest`. Add regression coverage for changed standalone behavior using `tests/atlas_fixture.py` and `tests/serve_standalone_fixture.py`, keeping tests independent of host games. Cover relevant Tiled serialization, persistence, revision conflicts, editor undo/redo, and recovery behavior. Connector v1 compatibility and connector Chrome acceptance are not requirements for new work. No numeric coverage threshold is configured. Run `make lint test` before submitting; run `make build` for packaging changes and Chrome acceptance checks for browser interactions.

## Commit & Pull Request Guidelines

Existing commits use short, imperative subjects such as “Preserve original scenes on first draft save.” Follow that style. Pull requests should explain the behavior change, link relevant issues, report validation commands/results, and include screenshots for visible UI changes.

## Architecture & Safety Boundaries

Forge is a standalone scene authoring tool built around imported artwork and portable Tiled projects. Forge owns generic rendering, atlas import, project storage, and Tiled serialization. Connector v1 and game-specific Apply/build integrations are no longer a supported direction; new work does not need to preserve their APIs, document formats, or behavior. Do not add connector compatibility adapters or design constraints for them. Existing connector code may be refactored or removed when it obstructs the standalone model. Preserve loopback binding, mutation-token checks, declared workspace paths, and conflict-aware recovery. Never introduce game-specific branches into the editor.
