# GBC Scene Forge

Version 0.1.0 is a local browser editor with an explicitly supplied Python game
connector. It has no runtime Python dependencies. The package contains its HTTP
service, browser UI, document storage, task runner and durable transaction store.
Atlas decoding, rendering, source translation and game builds belong to the host
connector. No connector is discovered or executed automatically.

## Development

```sh
make setup PYTHON=python3.12
make lint test build
```

The build creates `dist/gbc_scene_forge-0.1.0-py3-none-any.whl` and a source
archive, and tests the wheel in a clean environment. See
[building and releasing](docs/RELEASING.md) for tooling and manual PyPI publication.
There is no published release yet. Local hosts can install this checkout with
`python -m pip install -e ../gbc-scene-forge` or use their dependency manager's
editable path support.

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
