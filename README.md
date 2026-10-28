# GBC Scene Forge

![GBC Scene Forge — Build a world. One tile at a time.](assets/branding/hero.png)

Scene Forge is a local browser editor for standalone projects, imported gbc-atlas
artwork and native Tiled maps. It has no runtime Python dependencies. Standalone
scene authoring is the supported product direction; game connectors and
Apply/build integrations are legacy code and have no compatibility guarantee.

## Standalone projects

From an installed package, create or open a local project:

```sh
gbc-scene-forge /path/to/my-world --create "My world"
# Reopen after stopping the server:
gbc-scene-forge /path/to/my-world
```

From this checkout after `make setup`, use
`poetry run python -m gbc_scene_forge /path/to/my-world`. A new or empty directory
opens the project creation form; an existing project opens its scene list.
Open <http://127.0.0.1:8765/> (override with `--port`). Import a local
`*.atlas.json` manifest and its neighboring PNG, create a named scene, paint and
save. Each scene uses an 8, 16 or 32 pixel grid. Larger tile regions become stamps;
sprites can be placed at native size using their atlas origins, independently of
the scene grid. Named tile/object layers support ordering, visibility and active-layer
editing. Add spawn markers and trigger rectangles, then edit names, classes and
typed custom properties. Object and layer edits share undo/redo and save as Tiled
objects. Author terrain classifications and collision flags/shapes per shared
tile, then review terrain and collision overlays. **Export…** downloads a portable
scene or project ZIP for Tiled, with an option to include unsaved canvas edits.
Whole-project exports can also be reopened in Forge. Select a placed sprite to preview imported sprite animations, play or pause,
step frames, change playback speed, and inspect the origin marker. Assign explicit
idle/walk sequences for up, down, left, and right under **Sequence mappings**, then
choose a preview action and direction. Mappings are shared by instances of the same
sprite asset. **Save preview settings** stores mappings, animation choices, speeds,
origin display, footprint and collision preference in the project. Playback is
transient: it does not change saved assets, positions, scene dirty state, or undo history.
Under **Movement preview**, enable movement, click the scene, and use arrow keys or
WASD, or enter pixel waypoints and choose **Follow path**. Movement uses the mapped
idle/walk directions and an adjustable footprint relative to the sprite origin.
Optional collision checks use visible tile/sprite collision metadata; scene edges
always stop movement. **Pause movement** holds the pose and path; resume continues it.
**Reset position** restores the saved starting position;
Escape exits movement preview. Reopening restores saved preferences with playback
paused and movement disabled. Supported atlas sequences export as native Tiled
animations with their original timing. `export.json` reports sequences skipped
because they share a starting tile or do not fit an exported grid.

Projects contain `forge.project.json`, native `scenes/*.tmj` maps and shared
`assets/` tilesets/PNGs. Move the entire directory to relocate a project. The
original imported bundle is no longer required.

See [standalone usage and file compatibility](docs/STANDALONE.md) for the Tiled
subset, reimport behavior and recovery details.

## Installation

```sh
python -m pip install gbc-scene-forge==0.2.0
```

The [PyPI package](https://pypi.org/project/gbc-scene-forge/0.2.0/) includes the
browser UI, standalone launcher and service. Version 0.2.0 introduces standalone
projects; see the [release notes](docs/RELEASE-0.2.0.md) for features and
compatibility changes.

## Development

Install Python 3.10+, Poetry 2.4–2.x, Node 24.12+, npm, and Make, with their
executables on `PATH`. Follow the [Poetry installation guide](https://python-poetry.org/docs/#installation)
if needed. `make setup` checks prerequisites, uses Poetry to manage `.venv`,
installs locked dependencies, and bundles the frontend. It does not install Poetry.

```sh
make setup PYTHON=python3.12
make lint test build
```

`make check-deps` checks tool availability and Poetry/project compatibility without
installing dependencies. Override executable paths with `PYTHON`, `POETRY`, or
`NPM` when needed. Poetry checks Python compatibility; `npm ci --engine-strict`
enforces the frontend's Node requirement during setup.

The build creates `dist/gbc_scene_forge-0.2.0-py3-none-any.whl` and a source
archive, then checks metadata with Twine. Run `make check-dist` afterward to install
the wheel without dependencies in a fresh environment and run the small
`tests/package_smoke.py` suite. CI runs this installed-wheel check explicitly. See
[building and releasing](docs/RELEASING.md) for tooling and manual PyPI publication.
For local development, hosts can install this checkout with
`python -m pip install -e ../gbc-scene-forge` or use their dependency manager's
editable path support.

### Frontend workflow

Edit TypeScript in `frontend/`: `project.ts` owns the standalone project UI,
`layers.mts` owns active-layer editing, `model.mts` supplies tile editing/history,
`objects.mts` defines standalone object/property validation, `object-inspector.mts`
commits object dialog edits, and `atlas-import.mts` handles folder imports.
`decode.mts` provides checked JSON decoding. Server validation remains authoritative for project and Tiled data.
The remaining connector controllers are legacy code; their APIs and document
formats are not compatibility targets for new features.

- `make frontend`: type-check, then bundle the browser entry point with esbuild.
- `make typecheck`: check browser and test code with TypeScript strict mode.
- `make lint`: check Python plus TypeScript-aware ESLint, Prettier, and types.
- `make format`: format Python and frontend sources/configuration in place.
- `make test`: run Python contracts, typed editor-model tests, and API decoder tests.

Frontend formatting uses two spaces, single quotes, semicolons, and a 100-character
print width. Use explicit shared types and checked `unknown` values at JSON
boundaries; avoid `any`, unchecked casts, and type-check suppressions. Node runs
the TypeScript tests using built-in type stripping; `make typecheck` enforces types.

Generated JavaScript is Git-ignored; do not edit it. `make demo` and `make build`
run `npm run build`, which runs `tsc --noEmit` before esbuild. esbuild follows
imports, including nested modules, and produces the connector entry `static/app.js`
and standalone entry `static/project.js`, with external source maps.
`static/app.meta.json` records the connector entry's complete runtime dependency
graph and output sizes. Type errors stop the build before
existing assets are replaced. Bundles are readable and unminified.

After changing frontend code while a server is running, run `make frontend` and
reload the page. Use `make build` for releases so assets are always rebuilt first.
When invoking Python build tools directly from a checkout, run `npm ci` and
`npm run build` first. Hatchling packages the required bundle and source map using
declarative file inclusion and rejects missing assets. Wheels and source archives
include prebuilt assets, so installing and running a release needs no Node.

Configured API deadlines cover headers and body reads, including downloads and
HTTP error bodies. Incompatible JSON/task responses stop automatic polling with
an actionable message; the task may still have completed, and Reconnect retries
status retrieval explicitly. Temporary connection failures continue to retry.

## Legacy connector code

The repository still contains the former connector/demo implementation and its
tests. It is not a supported API or a compatibility target. See the
[legacy implementation notes](docs/LEGACY-CONNECTOR.md) for source reference.
New features use the standalone project and Tiled model.

## License

[MIT](LICENSE). Copyright (c) 2026 Michael Clifford.
