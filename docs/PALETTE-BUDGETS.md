# GBC scene palette budgets

Choose **GBC palettes…** in an open project to enable the optional palette profile.
Enter the background/window and sprite slots reserved by your game, then choose
**Save profile**. Blank reservations mean unknown; enter zero explicitly when no
additional slots are required. The profile is project-wide and independent of
scene undo history. Existing projects remain opted out until you enable it.

The toolbar reports whether the current canvas fits, exceeds, or has an
unverified budget. The dialog shows required, available, and reserved counts for
each pool. Expand a palette to inspect its ordered colors and contributing
placements. Choosing a contributor selects its layer and canvas location. For a
hidden layer, Forge keeps it hidden and explains how to show it for inspection.
Animation-frame contributors navigate to the placement that requires them.

Reports update after canvas edits, undo/redo, scene switches, imports/reimports,
and saved profile changes. Pending results replace the old result immediately;
late responses for older canvases are ignored. An idle editor rechecks revision
guards every five seconds. External project, scene, or managed asset changes
make the report unavailable until the conflict is resolved or the project is
reopened. Profile edits must be saved before validation can run.

## What profile v1 counts

- Eight BG/window palette slots and eight independent OBJ slots. Each BG palette
  uses four ordered RGB5 colors; OBJ comparisons use ordered entries 1–3 because
  entry zero is transparent. Distinct visible index orderings stay distinct.
- Every authored tile and sprite placement in every layer, including hidden
  layers. Layer visibility is an editing aid, not a runtime exclusion policy.
  Point and rectangle markers contribute no artwork palette requirements.
- For a placed grid tile, every 8×8 cell inside that grid tile. A multi-cell
  region's unplaced portions contribute nothing. Sprite objects contribute all
  8×16 pairs inside their native region.
- Every frame of every atlas sequence containing a placed region, transitively
  including sequences sharing those frame regions. Tile frames use the same
  grid offset and footprint as the original placement; sprite frames use the
  whole frame region. This conservative policy does not depend on preview
  animation selections, action mappings, playback time, speed, or movement.
- Only referenced palettes, sharing equivalent palettes across atlases within
  the same pool. A palette declaration unused by the selected artwork does not
  consume a scene slot. BG and OBJ never share a pool.

The profile assumes static residency without streaming or mid-frame palette
changes. Reservations account for additional UI/window graphics, effects, and
dynamic actors. An unknown reservation or unusable palette metadata produces an
unverified result, even if the known artwork appears to fit. A known requirement
above the hardware limit still fails when reservations are unknown. Forge does
not recolor artwork, reorder entries, remap indices, or allocate runtime slots.

**Run GBC palette preflight** performs an explicit check of the current canvas,
including unsaved edits. It passes only when both pools fit and their reservation
budgets are explicit. This is a palette preflight, not a whole-game compatibility
certificate: a consuming build still owns final palette allocation, VRAM, OAM,
timing, and runtime behavior. Generic Tiled export remains available when a GBC
check fails or is unverified.

Hardware reference: [Pan Docs — Palettes](https://gbdev.io/pandocs/Palettes.html).
Metadata reference: [gbc-atlas v0.3.1 manifest v1 contract](https://github.com/cliffom/gbc-atlas/blob/v0.3.1/src/gbc_atlas/skills/create-atlas/references/format.md#palette-interpretation-for-scene-consumers).
Forge reads the existing manifest fields directly; installing or running
gbc-atlas is not required by Forge.

## Saved projects and portable exports

The optional `gbc_palette_profile` field lives in `forge.project.json`:

```json
{"version": 1, "bg_reserved": 2, "obj_reserved": null}
```

Here BG has six slots available, while the OBJ runtime reservation is unknown.
Each reservation accepts an integer 0–8 or null. Disabling the profile removes
the field. No target metadata is added to generic Tiled maps or tilesets. Whole
project exports retain the profile; scene-only exports remain ordinary Tiled
maps and dependencies. Forge versions predating this optional field cannot open
an enabled project; disable the profile with a current Forge version first if
you need to reopen it with an older release.

Profile saves use the same revision guards, asset checks, and durable
transactions as other project mutations. Reports are read-only snapshots and
are not stored as permanent evidence of compatibility.

## Headless preflight and API

Check a saved scene using its stable ID from `forge.project.json`:

```sh
gbc-scene-forge --project /path/to/project --palette-preflight SCENE_UUID
```

The command prints the structured JSON report and exits 0 for a pass, 1 for
failed/unverified/disabled checks, and 2 for invalid input or revision conflicts.
It uses the persisted profile and saved scene, without starting the HTTP server.

The loopback API provides token-protected JSON POST routes:

- `/api/save-palette-profile`: `{profile, project_revision}`; profile can be null.
- `/api/palette-report`: `{scene_id, project_revision, scene_revision, scene?}`.
- `/api/palette-preflight`: the same snapshot input; HTTP 200 for pass and 422
  for fail, unverified, or disabled. Revision conflicts return 409.

Omit `scene` to check the saved scene; otherwise pass the normal Forge scene
model for an unsaved canvas. Both saved revisions remain mandatory. Reports
include their version, source revisions, profile, layer/frame/residency policies,
status, errors/warnings, separate pool budgets, ordered palette identities, and
contributing scene/layer/cell/object/atlas/region/frame locations. Missing
metadata contributors appear separately. Consumers should check `status`, not
infer a pass from a zero error count or a known palette count alone.

## Reproduce the cross-project examples

The independent synthetic bundles and expectation oracle under
`tests/fixtures/palette-semantics/` come from gbc-atlas v0.3.1. They are draft
fixtures, not approved production artwork. Their source guide describes exact
pixel patterns and palette identities. Forge integration tests establish:

| Composition | BG required | OBJ required | Explicit reservations | Result |
| --- | --- | --- | --- | --- |
| `mixed.ground`, `mixed.actor_a` plus linked `walk` frames, `bank.strip`, `bank.actor` | 8 | 2 | 0 / 0 | Pass |
| Same, plus `reordered.swapped` | 9 | 2 | 0 / 0 | Fail BG |
| Passing artwork | 8 | 2 | 1 BG / 0 OBJ | Fail BG: 7 available |
| Passing artwork | 8 | 2 | Unknown in either pool | Unverified |

From a development checkout, create a new disposable project containing the two
boundary scenes, then open it:

```sh
.venv/bin/python tests/support/prepare_palette_fixture.py --root /tmp/forge-palette-example
make run PROJECT=/tmp/forge-palette-example PORT=8777
```

Choose either scene, open **GBC palettes…**, and run preflight. To verify the
upstream half independently in an environment with gbc-atlas 0.3.1 installed:

```sh
gbc-atlas validate tests/fixtures/palette-semantics/mixed/mixed.atlas.json
gbc-atlas validate tests/fixtures/palette-semantics/bank/bank.atlas.json
gbc-atlas validate tests/fixtures/palette-semantics/reordered/reordered.atlas.json
```

For authored artwork, export the native PNG from Aseprite without scaling or
color conversion, describe its ordered palettes, cell assignments, regions and
frames in manifest v1, and run `gbc-atlas validate` on that bundle. Import it into
Forge and compose the scene before checking the scene budget. This path uses the
same bundle contract as the synthetic examples. Technical validation at either
stage does not establish human artwork approval.

To reproduce the Aseprite round trip with the synthetic examples, with `aseprite`
and gbc-atlas 0.3.1 on `PATH`, use fresh output directories:

```sh
for pack in mixed bank reordered; do
    mkdir -p "/tmp/forge-palette-artwork/$pack"
    aseprite -b "tests/fixtures/palette-semantics/$pack/atlas.png" \
        --save-as "/tmp/forge-palette-artwork/$pack/atlas.aseprite"
    aseprite -b "/tmp/forge-palette-artwork/$pack/atlas.aseprite" \
        --save-as "/tmp/forge-palette-artwork/$pack/atlas.png"
    cp "tests/fixtures/palette-semantics/$pack/$pack.atlas.json" \
        "/tmp/forge-palette-artwork/$pack/$pack.atlas.json"
    gbc-atlas validate "/tmp/forge-palette-artwork/$pack/$pack.atlas.json"
done
.venv/bin/python tests/support/prepare_palette_fixture.py \
    --artwork-root /tmp/forge-palette-artwork --root /tmp/forge-palette-roundtrip
make run PROJECT=/tmp/forge-palette-roundtrip PORT=8777
```

The expected eight-/nine-BG and two-OBJ counts remain the same after exporting
through Aseprite. These synthetic documents have one atlas image; animation
frames are named region references in the manifest, rather than inferred from
an Aseprite timeline.
