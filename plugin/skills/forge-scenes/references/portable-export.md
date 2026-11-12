# Portable export and reopen

Choose the requested scope. `export_bundle(project,project_revision,scope:"project")`
captures saved scenes, managed assets and the project manifest. `scope:"scene"`
also requires the saved `scene_id` and `scene_revision` and includes one map plus
Forge transfer metadata. Read fresh revisions after all scene/artwork/browser
saves. Exports are immutable snapshots; scene dry runs, retained artwork handles,
browser checkpoints, Undo and other unsaved work are excluded. Do not save unrelated
work to make it appear in an export.

The result is a ZIP resource, not a local output path. Use the client's supported
resource download/read capability and report the returned filename. Never treat
an MCP resource URI as a filesystem path. MCP artifacts cap at 16 MiB, with a
24 MiB session cache; download promptly and regenerate if expired. Larger exports
use the browser, subject to the native 256 MiB uncompressed export computation
limit. Resource-limit failure is not permission to drop assets, flatten artwork
or split references silently.

Portable bundles use finite orthogonal Tiled JSON maps (`.tmj`), external
image-collection JSON tilesets (`.tsj`) and PNG images with relative references.
They retain ordered layers, supported typed object properties, native sprite
origins and supported tile animation timing. Read the included export guide and
`export.json`: it records revisions/checksums and skipped animation mappings.
Tiled supports only one animation per starting tile; named actions/directions
are Forge preferences, not actor behavior. Scene-only connections may point to
scenes outside the ZIP. Recommend project scope when a complete connected world
is needed. No engine build, transitions, physics or runtime compatibility is implied.

Verification is a separate step from receiving a ZIP:

- Download and extract into a separate user-chosen directory, keeping `assets/`
  beside `scenes/` and moving the whole extracted tree together. Follow the normal
  client/file workflow; export grants no arbitrary filesystem access.
- For project scope, use forge-start's native chooser to open the extracted root
  as one project. Reread its catalog/scenes, open the saved scene in the managed
  browser and check artwork, layers, objects, camera and connections against the
  source. For scene scope, use browser **Import → Forge export ZIP** in a disposable
  destination, review preflight, save and reopen the imported scene.
  Scene transfer creates new scene/asset/definition identities and omits world
  connections/positions, project settings, preview preferences and the stamp
  library. Use a project bundle to reopen the complete authoring project.
- If Tiled is available, open the extracted map with its assets offline and check
  relative resource resolution. Tiled is an optional additional interoperability
  check, not a required dependency for Forge authoring.

If the client cannot download/extract/reopen within its available capabilities,
give these exact steps to the user and report reopen as unverified. A valid ZIP,
checksum check or successful tool call alone is not evidence that exported scenes
reopened or looked correct. Reopening switches project selection; return through
the chooser when requested and refresh guards/resources afterward.
