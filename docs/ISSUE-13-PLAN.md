# Standalone projects and saved scenes

Implementation plan for [#13](https://github.com/cliffom/gbc-scene-forge/issues/13),
the first milestone of [#12](https://github.com/cliffom/gbc-scene-forge/issues/12).

## Decisions

- Forge owns standalone project storage, atlas import, rendering and Tiled files.
  Standalone projects are the supported direction. Connector v1 compatibility
  and game-specific Apply/build integration are no longer requirements.
- A version-1 `forge.project.json` records a persistent project UUID, display name,
  scene UUIDs and relative paths, imported atlas metadata and preview settings.
  The project directory is the declared workspace; imports are explicit inputs.
- Native maps are finite orthogonal `.tmj` files with one tile layer, unsigned
  JSON-array GIDs, external `.tsj` tilesets and project-local PNGs. Reject richer
  maps and unsupported fields before rewriting them. An optional `Sprites` object
  layer stores native-size sprite placements. General object/layer authoring,
  collision editing and animation playback belong to later milestones.
- Painting uses square grids of 8, 16 or 32 pixels. Tile regions divisible by
  the selected grid become stamps of cells. Stable references include atlas ID,
  region name and cell offset. All regions are shown in the palette. Sprites are
  placed independently of the grid at native size, anchored by their atlas origin;
  selection, dragging, deletion, undo/redo and persistence include sprites.
- Import requires a version-1 `*.atlas.json` and its declared PNG. Optional
  authoring/review files are not needed to paint; their metadata is retained as
  provenance. No atlas approval or generated game tile indices are required.
- External tilesets use image collections with cropped cell PNGs and persistent,
  append-only local tile IDs. Map GIDs are derived from those IDs; zero is empty.
  Atlas metadata and source PNGs remain available inside the portable project.
- Reimport is explicit. Unchanged imports preserve references. Artwork, palette,
  origin and animation changes are reported. Region removal or geometry/kind
  changes block replacement; resolving those changes is deferred. Moving a region
  within a sheet is compatible and updates its cropped images.
- Project mutations use filesystem locking, raw-byte revision guards and durable
  multi-file transactions. Recover interrupted operations before opening projects;
  preserve external edits when recovery encounters conflicts.
- Standalone rendering uses browser canvas and project-local images, with no
  runtime Python dependency. PNG import supports a documented, validated subset.

## Delivery and verification

1. [x] Project manifest, create/open launcher, revision checks and recovery.
2. [x] Atlas bundle validation, copied assets, stable identities and reimport reports.
3. [x] Tiled read/write subset, stable mapping and round-trip fixtures.
4. [x] Standalone browser UI and rendering, reusing the existing editing model.
5. [x] Regression and Chrome acceptance tests, installed-wheel smoke checks and docs.
6. [x] Restore main's UI finish: shared branding/styles, compact document/tool
   bars, searchable/filterable asset grid, scene/selection inspector, framed
   full-height canvas, modal creation/import and clear inline errors. Verify
   desktop and smaller-window layouts in Chrome before calling #13 ready.

Verify the complete create → import → create scene → paint → save → restart →
reopen workflow; independent scenes sharing assets; moving the project; unchanged
and changed reimports; invalid paths/imports; stale revisions and interrupted
transactions; and Tiled compatibility. Run `make lint test build check-dist` and
standalone Chrome acceptance checks. Connector compatibility is not a requirement.

## Progress

- Implemented in the working tree, October 27, 2026. No release published.
- `make lint test build check-dist` passed: 61 Python regression tests,
  TypeScript model/API/deadline/build checks and four installed-wheel smoke tests.
- Standalone Chrome acceptance passed, including project creation, atlas import
  and reimport, painting, fill, selection, undo/redo, two scenes, a production CLI
  restart after moving the project and deleting the original imports, and a
  visible revision conflict preserving the external file and unsaved canvas.
  Sprite coverage includes palette thumbnails, origin-based placement, dragging,
  keyboard movement, deletion/undo and save/reopen after a directory move.
  A tall-canvas regression checks that focusing the canvas does not scroll and
  shift the pointer's placement coordinate.
- Existing connector Chrome acceptance passed, including reviewed Apply,
  rollback and reconnect behavior.
- Official Tiled 1.12.2 loaded/exported the generated map, Forge reopened its
  output, and `tmxrasterizer` produced the expected tile and transparent pixels.
  The repeatable check is `tests/tiled_interop.py`.
  This includes native-size sprite objects and atlas-origin conversion.
- Read-only validation of the owner's Dover atlas in a disposable project showed
  all 13 sprite regions and verified placement, save/reopen and exact native PNG
  pixels. Existing imported atlases gain sprite tilesets on their next explicit
  project mutation; merely opening a project does not rewrite it.
- Recovery regressions cover interrupted multi-file import, interrupted initial
  project creation, and preservation of external edits during recovery.
- Usage and format details: [STANDALONE.md](STANDALONE.md).
- Browser screenshot: [standalone project](screenshots/standalone-project.png).
- Standalone now reuses main's stylesheet, logo and favicons, three-pane editor
  layout, tool styling and dialog styling. Creation/import are modal; the library
  has search, atlas/kind filters and compact thumbnails; the inspector displays
  scene dimensions, sprite/selection details and atlas update actions. Pan, tool
  shortcuts, deselection and asset drag-and-drop are restored. Import failures
  remain visible in their dialog and successful import reports remain available
  in the inspector.
- Chrome verifies modal errors and closing, canceled discard, search/filter
  counts, drag-and-drop, pan without dirtying the scene, selection inspection,
  and a 980 × 760 layout without horizontal page overflow. Screenshots were
  inspected at both desktop and compact sizes; final product review remains with
  the owner.
- Sprite origins now snap to the nearest in-bounds grid intersection by default
  during placement, drops and dragging. Alt bypasses snapping; arrow keys nudge
  one pixel; selecting an off-grid sprite does not move it. Chrome checks cover
  snapping, Alt placement/dragging, disabled snapping and boundary clamping.
- Scene deletion has an explicit confirmation with an unsaved-edit warning,
  project/map revision guards, and a durable transaction removing the map and
  manifest entry together. Regression coverage includes cancellation, stale
  revisions, shared asset retention, preserving another scene's dirty canvas,
  deletion of the last scene and interrupted-delete recovery.
- Atlas import uses a browser-owned folder picker with a directory-upload fallback.
  It lists manifests, supports multiple choices and nested PNG paths, and reads
  only the selected manifest/PNG on explicit import. Cancellation preserves the
  prior selection; manual local paths remain available. Native picker helper
  processes and polling endpoints have been removed.
- Uploads use the existing atlas validator and project transaction/revision
  guards. Regression coverage includes bundle/path parity, shared-asset reimport,
  missing files, size limits, unsafe paths, source preservation, mutation-token
  enforcement, and browser folder selection without picker HTTP requests.
- Project assets include confirmed atlas deletion. Saved/unsaved placements block
  removal; stale project, scene and asset revisions prevent deletion. Unused
  managed copies, manifest entries and map tileset ranges update atomically,
  preserving other placements, source files and undeclared local files. Current
  edits survive; history referring to removed assets is cleared with a warning.
  Tests cover dependency errors, cancellation, GID remapping, saving a retained
  dirty canvas, deleting the last atlas and interrupted-delete recovery.
- Final diff review fixed concurrent-read and save-acknowledgment races. Scene
  reads share the transaction lock so atlas origins and rewritten maps stay
  consistent; image reads check catalog revisions and managed asset hashes.
  Create/save responses acknowledge their own committed bytes, preserving
  conflict detection if an external edit follows immediately. Deterministic
  regressions cover each case.
