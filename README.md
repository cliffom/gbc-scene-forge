# GBC Scene Forge

Version 0.1.1 is a local browser editor with an explicitly supplied Python game
connector. It has no runtime Python dependencies. The package contains its HTTP
service, browser UI, document storage, task runner and durable transaction store.
Atlas decoding, rendering, source translation and game builds belong to the host
connector. No connector is discovered or executed automatically.

## Installation

```sh
python -m pip install gbc-scene-forge==0.1.1
```

The [PyPI package](https://pypi.org/project/gbc-scene-forge/0.1.1/) includes the
browser UI and service. A host game supplies the connector and launcher described below.

## Development

```sh
make setup PYTHON=python3.12
make lint test build
```

The build creates `dist/gbc_scene_forge-0.1.1-py3-none-any.whl` and a source
archive, and tests the wheel in a clean environment. See
[building and releasing](docs/RELEASING.md) for tooling and manual PyPI publication.
For local development, hosts can install this checkout with
`python -m pip install -e ../gbc-scene-forge` or use their dependency manager's
editable path support.

## Run the demo

After `make setup`, launch the bundled demo connector:

```sh
make demo
```

Open <http://127.0.0.1:8765/>. Choose **Village square** or **Riverside crossing**
and click **Open current version**. Paint terrain from the palette, switch between
day/night previews, and toggle the collision overlay. Save drafts, export a scene,
or review and Apply edits to the demo sources; **Undo Apply** restores the previous
version. Stop with Ctrl+C.
This example compiles tile indexes into binary files; it does not build a game ROM.

The connector in `src/gbc_scene_forge/demo/` is explicitly launched by this target.
It copies bundled seed scenes into `.demo/levels/` on first launch. Subsequent
launches preserve edits. Drafts (including original snapshots), sources, compiled
files, reviews, and transaction history stay inside the Git-ignored `.demo/`
workspace. To start fresh, stop the server and run `make clean-demo`; this deletes
the checkout's `.demo/` directory and all saved demo work. `make clean` only removes
build artifacts and preserves the demo workspace. Custom `DEMO_ROOT` directories
must be removed separately.

Use `make demo PORT=8777 DEMO_ROOT=/tmp/forge-demo` to change the port or workspace.
Custom workspace paths outside `.demo/` need their own Git ignore rule if placed
inside a checkout. Installed packages can launch the same demo with
`python -m gbc_scene_forge.demo --root /tmp/forge-demo --port 8777`.

## Launching

Install the package through the host project's locked dependencies. A host launcher
constructs its connector and calls:

```python
from gbc_scene_forge.server import serve

serve(connector, port=8765)
```

The connector supplies an explicit `Workspace(root, drafts, history, reviews)`.
The service binds to loopback and uses a per-session mutation token. Connectors
are trusted local Python code, not a sandboxed plugin system. The host must recover
existing transactions before importing game modules that require approved sources.

## Connector contract version 1

`gbc_scene_forge.contract.Connector` specifies the interface. Its implementation
supplies:

| Method | Responsibility |
| --- | --- |
| `catalog()` | Project identity, capabilities, target profiles, image families and asset entries |
| `load(target, template=False)` | Working scene, fixed cells, constraints, marker annotations and draft revision |
| `normalize(scene)` / `check_shape(scene)` | Legacy document interpretation and structural game validity |
| `source_revision(target)` | Opaque revision of relevant source dependencies |
| `preview(scene, light, state, frame)` | PNG data URL, collision grid and authoritative comparison result |
| `validate(scene)` | Validity, errors/warnings and structured issues |
| `compare(scene)` | Whether game-relevant content differs; not restricted to the cell grid |
| `asset(name)` / `export(scene)` | Encoded image bytes and the connector's portable handoff |
| `input_files(root)` / `output_files(root)` | Explicit workspace file inventories |
| `prepare(scene, stage, review_id)` | Staged candidate and a `BuildPlan` |
| `approve(plan, stage, review_id)` | Bind project-specific approval metadata after explicit review confirmation |
| `activity(text, fallback)` / `refresh()` | Project-specific activity descriptions and cache invalidation |

Catalog profiles declare `cell_size`, `erase_cell`, `lighting`, `states`, optional
`guide` dimensions and `animation_frames`/`animation_interval_ms`/`animation_label`. Asset entries declare
opaque `id`, display label, family, compatible profiles, and either an explicit
image `rect` or a stamp's `cells`. Sprite references set `reference: true`; their
rectangles may declare an origin. The browser never decodes IDs or map characters.

Capabilities control Apply, export, templates and composition references. Every
project supplies at least one profile and preview mode. Required contract methods
remain available even when an operation reports unsupported capabilities.

The working grid schema retains `profile` as the opaque target key and
`source_digest` as an opaque revision for compatibility. Fixed coordinates are
returned as `locked`; `constraints` supplies reasons. Conditional game rules stay
authoritative in connector validation. Issue objects contain `code`, `message`
and, when available, a cell or region location.

## Documents

New saves and JSON downloads use envelope version 2:

```json
{
  "version": 2,
  "connector": "example-game",
  "id": "draft-name",
  "name": "Draft name",
  "target": "room",
  "source_revision": "opaque-revision",
  "content": {
    "width": 7,
    "height": 5,
    "cells": [],
    "references": []
  }
}
```

The illustrative `cells` must contain the declared number of rows and columns in
a real document. Connector extensions live inside `content` and survive saves.
Version-1 flat documents pass through connector normalization. Loading leaves
their original bytes untouched; saving migrates that file with its existing ID
and raw-byte revision guard. Unsupported versions, connector identities and
unrecognized envelope fields are rejected without rewriting files. Existing
source-staleness checks still apply to migrated drafts.

## Original scene snapshots

The first successful draft save for each scene preserves the connector's current
game document in `Workspace.drafts/.originals/`. It captures the live scene before
draft edits, including when the first saved draft came from a template or import.
The key includes connector identity and target, without interpreting target IDs.
Later saves, Apply, Undo and draft deletion never overwrite or remove that file.

**Open original** appears for the selected scene when its snapshot exists. It loads
the preserved content into the editor with an **ORIGINAL** tag. The button is
disabled while that original is open without edits; editing re-enables it, and
loaded drafts always allow opening the original even when their content matches.
Restoration uses the current
source revision for normal validation and reviewed Apply. Loading changes no game
files. **Open current version** continues to load today's game sources; **Revert
changes** still restores the last opened/saved canvas. Unsupported historical
content or changed fixed cells still fail connector validation rather than bypass
it. Original snapshot bytes remain unchanged when loaded.

Snapshots start with the game state at the first save after this feature is
installed; earlier game changes cannot be reconstructed from existing drafts.
Keep the `.originals/` files with the workspace for long-term restoration.

## Apply and recovery

`BuildPlan` declares candidate source paths, allowed outputs, required artifacts,
ordered `CheckStep` commands, environment, review views and approval data. Commands
are argument arrays, run in an isolated candidate directory. Preparation and
approval operate on that directory; connectors must not mutate live sources.

The runner checks source, candidate and installed editor-package fingerprints, rejects escaping paths,
requires declared artifacts, excludes only declared outputs from the frozen-source
comparison, and promotes only declared sources/outputs. It preserves process-group
cleanup, bounded output, worker health, reconnectable status, conflict-aware
rollback and interrupted-transaction recovery. Existing transaction/job formats
are retained; history paths come from the workspace.

## Independent acceptance fixture

`tests/fixture_connector.py` provides a different 7 × 5 scene with four-pixel cells,
opaque asset IDs, non-grid game content, JSON sources and a small Python compiler.
It imports no host game, atlas library or imaging library. Run:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python tests/serve_fixture.py --root /tmp/forge-fixture --port 8777
node tests/browser.mjs http://127.0.0.1:8777/
```

The browser check requires a local Chrome installation; its third argument can
override the default macOS executable. The fixture proves this contract is
independent of one game. Additional real games may require explicit future
capabilities rather than game-specific branches in the editor.

## License

[MIT](LICENSE). Copyright (c) 2026 Michael Clifford.
