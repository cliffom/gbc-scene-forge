# Repository Guidelines

## Project Structure & Module Organization

`src/gbc_scene_forge/` is organized by domain: `project/`, `scenes/`, `scene_objects/`, `artwork/`, `planning/`, `analysis/`, `formats/`, `storage/`, `core/`, and `adapters/`. See `docs/ARCHITECTURE.md` for ownership, dependency direction and guarded-read/transaction contracts. `project.application.Project` composes domain services; add operations to their owning services rather than expanding that facade. Unsupported connector/document/Apply code is isolated in `legacy/` and must not be imported by supported standalone entry points. Browser HTML, CSS, and generated JavaScript live in `src/gbc_scene_forge/static/`; editable TypeScript lives in `frontend/`. `tests/` contains domain Python tests, TypeScript checks, Chrome acceptance, Tiled interoperability, and installed-wheel smoke tests; historical connector fixtures/tests live under `tests/legacy/`. `docs/RELEASING.md` documents releases.

## Build, Test, and Development Commands

Install Python 3.13, Poetry 2.4–2.x, Node 24 (24.12+), npm, and Make on `PATH`.

- `make help`: list setup, standalone launch, test and build targets.
- `make run [PROJECT_ROOT=/path]`: rebuild and browse projects (default `.forge_project/`). Use `PROJECT=/path` to open one project directly.
- `make demo`: rebuild, restore the tracked `assets/demo/project/` into `.demo/`, and serve it. Each launch resets demo scenes and assets; use `make run PROJECT=.demo` to preserve edits.
- `make check-deps`: check installed tools and Poetry/project compatibility.
- `make setup PYTHON=python3.13`: use Poetry to manage `.venv`, install locked dependencies, and bundle the frontend.
- `make lint`: run Ruff, scoped Python mypy checks, ESLint, Prettier, and strict TypeScript checks.
- `make typecheck-python`: check shared primitives, file helpers and saved-read contracts.
- `make test`: run Python `unittest` discovery and TypeScript model/API/build checks.
- `make test-frontend-<suite>`: run one TypeScript suite, such as `drafts` or `model`; `npm test` delegates to `make test-frontend`.
- `make build`: bundle the frontend, build source/wheel distributions, and check metadata.
- `make check-dist`: install the built wheel in a fresh environment and run `tests/package_smoke.py`.
- `.venv/bin/python tests/serve_standalone_fixture.py --root /tmp/forge-fixture --port 8777`: launch a disposable standalone project fixture.
- `make test-browser [CHROME=/path]`: rebuild and run all Chrome acceptance suites in disposable workspaces.
- `make test-standalone-browser` / `make test-drafts-browser`: run editor or unsaved draft recovery Chrome acceptance independently.
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
