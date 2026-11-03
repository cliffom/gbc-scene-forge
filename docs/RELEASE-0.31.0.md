# Scene Forge 0.31.0

Prepared feature release for general pixel illustrations and a usable artwork
palette. Publication is separate.

## Changes

- Static sprite documents accept arbitrary positive integer dimensions up to
  4,096 pixels per axis and 4,194,304 pixels total. Card-sized artwork can be
  created, edited, reviewed, recovered, saved and exported as one document.
  Tiles and animation sheets retain their grid constraints.
- Large browser edits use compact candidate handles and rectangular RGBA chunks.
  MCP pixel editing also accepts bounded rectangular patches; reads require
  explicit rectangles for documents larger than 65,536 pixels.
- Whole-document review images stay within 1,024 pixels per axis. Detail views
  select native pixel regions while review receipts guard the full candidate.
- Changed-block undo history retains up to 100 operations under a separate
  64 MiB budget. Canvas backing allocations remain bounded when zooming, and
  Fit includes fractional zoom levels.
- The artwork palette opens as a dropdown with a scrollable 12-column grid,
  sorted by hue with neutral colors first. Keyboard navigation and exact RGBA
  selection include partial alpha and hidden RGB. More than 1,024 source colors
  produces an explicit display-limit notice; Eyedropper remains available.
- The Library entry is labeled **Import** and retains its artwork/map format chooser.
- Native PNGs allow 17 MiB encoded data, candidates 24 MiB, and artwork recovery
  records 49 MiB. Candidate storage retains its separate 64 MiB project quota; recovery storage
  allows 128 MiB so a recovered copy can coexist with its original. Forge ZIP intake allows 40 MiB compressed and 17 MiB
  per PNG, retaining the 256 MiB expanded budget.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.31.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.31.0'
```

Existing projects need no migration. New artwork uses the existing native static
sprite representation and portable Tiled image collections. Older Forge releases
reject artwork outside their dimension or payload limits. Print/PPI and laser
control features are outside this release.

Exact straight RGBA, source origins, declared paths, conflict checks, review-bound
commits and owned recovery remain required. Aggregate quotas can fill before
record-count limits; export and release superseded MCP candidates explicitly.
Review overview pixels may be sampled; use detail views or exact pixel reads for
native inspection. General authoring request limits remain separate.

See [pixel artwork](user/pixel-artwork.md), the [native contract](EDITABLE-ARTWORK.md)
and [MCP guide](MCP.md) for units and workflows. Checks and limitations belong in
[Validation](VALIDATION.md); current priorities belong in the [roadmap](ROADMAP.md).
