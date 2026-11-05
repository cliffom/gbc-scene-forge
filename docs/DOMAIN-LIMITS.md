# Authoring limit ownership

This inventory covers consequential shared authoring boundaries for #171. Values
are existing policy, not new capacity claims. Python domain validators own saved
and candidate acceptance; MCP schemas advertise structural bounds; browser
schemas and controls mirror applicable limits. See the
[authoring outcome matrix](AUTHORING-OUTCOMES.md) for workflow parity and
[architecture](ARCHITECTURE.md) for service ownership.

## Artwork and animation

| Policy and units | Authoritative Python rule | Wire/schema representation | Browser enforcement | Service error |
| --- | --- | --- | --- | --- |
| Static sprite axes 1–4,096 pixels; area ≤4,194,304 pixels | [`dimensions.check`](../src/gbc_scene_forge/artwork/dimensions.py) | MCP `DIMENSION`, artwork capabilities | `artwork-limits.mts`, descriptor area check, creation controls | `Artwork axes must be integer pixels within 1..4096`; `Artwork area must be at most 4194304 pixels` |
| Tile/sheet axes 8–256 pixels, aligned to 8; single tiles square at 8/16/32 | [`dimensions.grid_canvas`](../src/gbc_scene_forge/artwork/dimensions.py), [`editable.check_descriptor`](../src/gbc_scene_forge/artwork/editable.py), [`model.GRIDS`](../src/gbc_scene_forge/artwork/model.py) | MCP `GRID_DIMENSION`, source-grid enum; tile sizes capability | `GRID_UNIT`, `MAX_GRID_AXIS`, `TILE_SIZES`; creation/frame controls and descriptor checks | `Tile/sheet dimensions must be multiples of eight within 8..256`; `Tiles must be one square of 8, 16 or 32 pixels` |
| 1–128 frames; 0–64 sequences; 1–256 timed entries per sequence; ≤1,024 entries total | [`sheets.check`](../src/gbc_scene_forge/artwork/sheets.py) | MCP `FRAMES`, `SEQUENCES`; sheets capabilities; aggregate remains cross-field policy | [`sheet-limits.mts`](../frontend/artwork/sheet-limits.mts), frame/sequence schemas, descriptor check and sheet buttons | `Use 1..128 frames`; `Use at most 64 sequences`; `Use 1..256 timed frames per sequence`; `Use at most 1024 total sequence frames` |
| Durations 1–65,535 milliseconds, compatible with APNG uint16 numerators | `sheets.MIN_DURATION_MS`, `MAX_DURATION_MS`; atlas import also uses these | MCP timed-entry schema | Timed-entry schema, duration input min/max and edit guard | `Sequence frames require an existing frame ID and duration within 1..65535 ms` |
| Frame rectangles aligned to 8 inside sheet; origins inside frame; sequence geometry compatible | `sheets.check` | Structural frame schema; service checks relationships | Descriptor check retains alignment, bounds, identities and sequence compatibility | `Frame rectangles must be aligned multiples of eight inside the sheet`; `Sequence frames must share geometry` |
| Descriptor ≤64 KiB of UTF-8 two-space JSON with final newline | `editable.MAX_DESCRIPTOR_BYTES`; descriptor validation/read and document loading | Candidate descriptor; not a JSON Schema character-count limit | `MAX_DESCRIPTOR_BYTES` and serialized descriptor check | `Editable descriptor exceeds 64 KiB` |
| 1–8 layers; composite plus every source ≤4,194,304 pixels (16 MiB RGBA8) | [`layers.check`](../src/gbc_scene_forge/artwork/layers.py), `dimensions.MAX_PIXELS` | MCP `LAYERS`, layer capabilities | `MAX_LAYERS`, layer-add guard, descriptor aggregate check | `Use 1..8 layers`; `Layers and composite exceed 4194304 aggregate pixels; reduce canvas or layer count` |
| 1–256 explicit selected placements; cell coordinates 0–2,047 inclusive; layer/object IDs 1–2,147,483,646 | [`editable.check_placements`](../src/gbc_scene_forge/artwork/editable.py); [`placements.replace`](../src/gbc_scene_forge/artwork/placements.py) checks actual saved fit | MCP `PLACEMENTS`, source-cell schema; placement variations capability | [`placement-limits.mts`](../frontend/artwork/placement-limits.mts), placement schema, selection capture guards | `Select 1..256 placements`; `Invalid tile placement coordinates`; `Invalid sprite object ID` |
| RGBA candidate ≤24 MiB; image ≤17 MiB; decoded document ≤16 MiB | `dimensions` and `editable.check_candidate` | Base64 maximum derived from decoded bytes; capabilities advertise byte budgets | `MAX_RGBA_BASE64`, pixel-count/canonical-base64 checks | `Artwork candidate exceeds 24 MiB`; image/pixel checks retain existing messages |
| Read/patch rectangle ≤65,536 pixels; 0–65,536 unique individual writes; individual-write JSON ≤1 MiB | `dimensions.MAX_READ_PIXELS`, `editable.MAX_PIXEL_WRITES`, `MAX_BATCH` | MCP write count/coordinate schema and pixel capabilities; rectangle area checked by service | `MAX_PIXEL_PATCH_PIXELS` bounds chunk synchronization | `Pixel read exceeds 65536 pixels; request smaller explicit rectangles`; `Use at most 65536 pixel writes`; `Pixel batch exceeds 1 MiB` |
| Raster 1–128 operations, ≤1 MiB canonical JSON and ≤16,777,216 visited pixels | [`raster.edit`](../src/gbc_scene_forge/artwork/raster.py) | MCP raster operation count and capabilities | Browser gestures use their own local history; service budget applies when using the operation API | `Provide 1..128 raster operations`; `Raster operations exceed 1 MiB`; `Raster batch exceeds pixel work budget` |
| Candidate batch 1–128 operations, ≤1 MiB record JSON, ≤16,777,216 pixel work including layer composition/nested rasters | [`workshop.batch`](../src/gbc_scene_forge/artwork/workshop.py) | MCP batch schema; illustration capabilities | Agent operation API; no equivalent browser batch-count guard | `Provide 1..128 candidate operations`; `Candidate batch exceeds 1 MiB`; `Candidate batch exceeds 16777216 pixel work` |
| Explicit conversion output 1–256 colors; source histogram/bundle palette ≤65,536 colors | `workshop.MAX_PALETTE_COLORS`, `MAX_SOURCE_COLORS` | MCP palette array/budget schema | Agent conversion API; browser literal-color display has its own display budget | `Use 1..256 RGB colors`; `Use an exact RGBA budget within 1..256`; `Conversion supports at most 65536 source RGB colors` |
| Cleanup scan ≤1,048,576 pixels; admission work ≤16,777,216 units; ≤4,096 findings with 256/page or selection; islands ≤16 cells; profile ≤128 KiB | [`cleanup`](../src/gbc_scene_forge/artwork/cleanup.py) owns scan/protection work, closed profiles and exact constraints | MCP cleanup profiles/proposals and cleanup capabilities; native source/composite limits still apply | Agent-only suggestions; browser adoption/manual edits use existing native contracts | `Cleanup scan exceeds 1048576 pixels; narrow rectangle`; `Cleanup exceeds 4096 findings; narrow rectangle or thresholds`; hard-constraint failures reject |
| Review enlargement 1–16; native overview fitted to ≤1,024 pixels per axis | [`review`](../src/gbc_scene_forge/artwork/review.py), [`animation_review`](../src/gbc_scene_forge/artwork/animation_review.py) | MCP review scale; review descriptions/capabilities | Existing review controls and API | `Review scale must be within 1..16`; animation review also bounds total frame pixels |

## Scene operations

| Policy and units | Authoritative rule | Wire/schema representation | Browser enforcement | Service error |
| --- | --- | --- | --- | --- |
| Grid 8/16/32 pixels per cell; positive integer cell axes; ≤8,192 pixels per axis; ≤65,536 cells | [`scenes.dimensions.check_dimensions`](../src/gbc_scene_forge/scenes/dimensions.py) | MCP grid enum and scene-creation description; cell/axis relationship remains service policy | [`scene/dimensions.mts`](../frontend/scene/dimensions.mts), creation/resize checks and blockout controls | `Choose an 8, 16 or 32 pixel grid`; `Scene dimensions must be positive whole cells and at most 8192 pixels per axis`; `Scene area must be at most 65536 cells` |
| 1–128 ordered layers; ≤4,096 objects per layer | `scenes.dimensions.MAX_LAYERS`, `MAX_OBJECTS_PER_LAYER`; [`tiled`](../src/gbc_scene_forge/formats/tiled.py), scene authoring and composition placement | MCP layer indices 0–127; canonical scene passed to owning validator | `MAX_SCENE_LAYERS`, `MAX_OBJECTS_PER_LAYER` in layer editor guards | `Use 1..128 layers`; `Use at most 128 layers`; `Invalid objects`; `Use at most 4096 objects per layer` |
| Scene edit 1–128 operations, ≤4 MiB JSON input, ≤4,096 total cell writes including repeats | [`authoring`](../src/gbc_scene_forge/scenes/authoring.py) | MCP edit count/cell bounds and capabilities | Agent operation API; browser scene/history edits have separate ownership | `Use 1..128 operations per atomic scene edit`; `Authoring input exceeds 4 MiB`; `Use at most 4096 tile edits per atomic batch` |
| Scene view ≤1,024 pixels per axis, ≤1,048,576 output pixels; ≤4,194,304 source and ≤16,777,216 composited pixels | [`rendering`](../src/gbc_scene_forge/scenes/rendering.py) | MCP viewport fields/capabilities; work checked by renderer | Existing bounded review requests | Existing viewport/output/source/composition errors remain with renderer |

## Contract boundaries and verification

[`domain-limits.json`](../tests/fixtures/domain-limits.json) is a small, independent
boundary corpus consumed by both
[Python](../tests/backend/artwork/test_domain_limits.py) and
[TypeScript](../tests/frontend/artwork/domain-limits.ts) tests. It pins lower,
upper and immediately-outside values, grid alignment, durations, layer counts,
selected-location IDs/coordinates, and serialized descriptor bytes (including a
non-ASCII name). Policy values are checked independently in both languages.
Python also exercises real operation batches, first-error ordering and MCP
advertising. Run `make test-frontend-domain-limits` and normal Python discovery.

Scene grids reuse the artwork grid-size definition within each language.
Independent limits compose: a sheet may satisfy the 1,024 timed-entry count and
still exceed the descriptor byte budget. The corpus preserves that case. No
schema field is added for aggregate counts or cross-field geometry. MCP frame
origins retain their broader structural range of 0–4,095; service validation narrows them to
the actual frame (the browser structural range is 0–255). MCP tile-edit cell
coordinates retain 0–65,535 structural bounds, with actual scene fit checked by
scene authoring. Selected locations retain wire coordinates through 2,047 even
when a particular scene is smaller. Python retains duplicate-location rejection;
the browser structural placement schema does not independently perform that
saved-selection policy check. The pixel service retains empty-write acceptance; the advertised MCP write
array retains its existing minimum of one. Operation batches require at least
one operation. MCP sheet-creation axes retain their broad structural dimension
schema, with tile/sheet alignment narrowed by the owning service.

JSON measurement rules also remain distinct: individual pixel writes use compact
JSON, raster batches use canonical JSON, candidate batches use record JSON, and
scene authoring uses its existing JSON encoding. Do not equate equal numeric
byte budgets with identical serialization. No limit, accepted input,
normalization, saved/native format or transport contract changes in this work.
Cache/history budgets, polling and checkpoint timing have separate
[runtime policy owners](FRONTEND-ARCHITECTURE.md#runtime-policy-ownership); this
inventory does not make runtime capacity claims about them.
