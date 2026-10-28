# Editable demo pipeline

This is the canonical demo, rather than generated launch-time artwork. All artwork
is original to Scene Forge and covered by the repository's MIT license.

- `artwork/atlas.aseprite`: editable 64×16 atlas, exported as `artwork/atlas.png`.
- `artwork/sample.atlas.json`: gbc-atlas v1 manifest with six four-color RGB5
  palettes, twelve 8×8 tiles, two 8×16 character poses, and idle/walk sequences.
- `artwork/riverside.aseprite`: editable 224×160 reference scene with two character
  poses at 160 ms per frame; `riverside.png` exports its first, idle-pose frame.
- `artwork/courtyard.aseprite`: editable 224×160 alternate scene and its PNG export.
- `project/`: portable Forge project containing the imported atlas, extracted tile
  and sprite images, Tiled tilesets/maps, terrain/collision data, markers, and
  saved character preview settings. It contains no transaction history.

The assets were authored and exported through Aseprite MCP, checked with
`gbc-atlas validate`, then imported and saved using Forge's project APIs. The
artwork preserves the previous demo's layout and pixels. The browser acceptance
suite opens the real demo and compares both rendered scenes pixel for pixel with
the Aseprite PNG exports, excluding only the editor's spawn/trigger guides.

## Run

From the repository root:

```sh
make demo
```

Every run restores the contents of `project/` into `.demo/` before serving it.
`DEMO_ROOT=/path/to/demo` changes the working copy location. Resets use Forge's
durable transactions, including before-images for recovery; they remove added
managed scenes/assets, preserve unrelated files, and refuse unrelated projects.
To preserve edits on later launches, use `make run PROJECT=.demo` instead.
The wheel bundles `project/`, so running the demo does not require Aseprite,
gbc-atlas, or access to this checkout.

## Update the demo

1. Edit and save the native documents in Aseprite. Export the atlas and scene PNGs
   without scaling or quantization. Export Riverside's first frame explicitly;
   exporting its entire animation produces more than one image.
2. Update the manifest's rectangles, palettes, origins, and sequences if needed.
   Keep RGB8 colors at the exact RGB5 expansion `(component * 255 + 15) // 31`.
3. Validate with gbc-atlas (the current fixture was validated with v0.3.0):

   ```sh
   gbc-atlas validate assets/demo/artwork/sample.atlas.json
   ```

   This checks and encodes the atlas in memory. The manifest remains a draft:
   technical validation does not record human art approval. Forge consumes the
   PNG and manifest directly; generated C arrays and a runtime handoff are not
   part of this demo.
4. Run `make demo` once, then use `make run PROJECT=.demo` for subsequent sessions.
   In Forge, import `artwork/` with **Update an atlas already in this project**,
   recreate/update the scenes to match the Aseprite references, and save.
5. Export **Whole project**. Extract `forge.project.json`, `assets/`, and `scenes/`
   from that ZIP into a clean replacement for `project/`. Keep portable relative
   paths; do not copy `.forge/` transaction history or the export report/guide.
6. Run `make lint test test-browser build check-dist` and review the demo
   screenshots under `build/reports/scene-editor/demo-*.png` before committing
   the editable sources, exports, manifest, and portable project together.

A fresh clone uses these checked-in files. Changing only the authoring artwork
does not silently regenerate the project; the import/save/export path above is
the integration being exercised.
