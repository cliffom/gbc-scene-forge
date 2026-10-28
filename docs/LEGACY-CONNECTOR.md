# Legacy connector implementation

This document records the former connector workflow for source reference only.
Standalone projects are now the supported product direction. Connector v1,
connector documents, demo integrations and reviewed Apply/build operations are
unsupported; new work may change or remove them without maintaining compatibility.
The descriptions below reflect the earlier implementation, not current support
commitments.

## Run the demo

After `make setup`, launch the bundled demo connector:

```sh
make demo
```

Open <http://127.0.0.1:8765/>. Choose **Village square** or **Riverside crossing**
to open its current version. The editor starts with no scene open. Switching scenes
prompts you to keep or discard unsaved edits. Use **Open current version** to reload
the selected scene. You can also open a saved draft, start from a template, or
import JSON explicitly. Paint terrain from the palette, switch between
day/night previews, and toggle the collision overlay. Click **Create draft**, enter
a name, and confirm to save a copy of the current canvas. Use **Save draft** to
update that draft, or **Create draft** again to save a separate copy. Export a scene
or review and Apply edits to the demo sources; **Undo Apply** restores the previous
version. Stop with Ctrl+C.
This example compiles tile indexes into binary files; it does not build a game ROM.

The connector in `src/gbc_scene_forge/demo/` is explicitly launched by this target.
It copies bundled seed scenes into `.demo/levels/` on first launch. Subsequent
launches preserve edits. Drafts (including original snapshots), sources, compiled
files, reviews, and transaction history stay inside the Git-ignored `.demo/`
workspace. To start fresh, stop the server and run `make clean-demo`; this deletes
the checkout's `.demo/` directory and all saved demo work. `make clean` removes
`build/`, `dist/`, `node_modules/`, and the generated bundle/map/metadata while
preserving the demo workspace. Run
`npm ci` or `make setup` to reinstall frontend dependencies afterward. Custom
`DEMO_ROOT` directories must be removed separately.

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
npm run test:browser -- http://127.0.0.1:8777/
```

The browser check requires a local Chrome installation; its third argument can
override the default macOS executable. The fixture proves this contract is
independent of one game. Additional real games may require explicit future
capabilities rather than game-specific branches in the editor.
