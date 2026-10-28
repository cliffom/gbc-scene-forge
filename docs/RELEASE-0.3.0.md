# Scene Forge 0.3.0

## Multiple projects, one running editor

Start Forge with `gbc-scene-forge` or `make run` to choose or create a project.
Projects live in `.forge_project/` by default. Creating **Hello World** gives it
its own `hello-world/` folder with a versioned manifest, artwork, maps and history.
Use `--project-root PATH` or `make run PROJECT_ROOT=PATH` for another location.

Choose **Projects…** to change projects. Unsaved scenes offer **Save and switch**,
**Discard and switch**, or **Keep editing**. Save conflicts preserve the editor
and your unsaved changes. Opening a project loads a fresh workspace, including
its assets and saved preview preferences, with no previous undo history or active
previews. Project-specific URLs keep requests and browser tabs isolated.

The selector discovers projects from immediate child directories; no registry is
required. Invalid or unsupported manifests are identified without rewriting them.
Name normalization handles accents and punctuation and rejects folder collisions.

## Existing projects

Manifest schema stays at version 1; 0.2.0 projects need no format migration.
Move an entire project folder into the new root, or open it directly with
`gbc-scene-forge --project PATH` / `make run PROJECT=PATH`.

The default changes from the single project `.forge-project/` to the container
`.forge_project/`. Existing directories are preserved and are not moved
automatically. Positional CLI paths now select a project root; `--project` selects
one project. Browser creation replaces `--create NAME`. Passing an existing project
as a root fails with guidance rather than nesting projects unexpectedly.

## Development and sample

`make setup` manages the local environment and builds the UI. `make demo` creates
or reopens an editable sample with original artwork, two scenes, collision
metadata and an animated character. Make supports project roots, direct project
paths, sample locations and port overrides. Cleanup preserves projects;
`make clean-demo` explicitly removes only the default sample.

See the [README](../README.md) for the everyday workflow and
[release instructions](RELEASING.md) for validation and publication. This release
preparation does not publish to PyPI; publication follows review and tagging.
