# Scene Forge 0.6.0

Reusable object definitions for issue [#24](https://github.com/cliffom/gbc-scene-forge/issues/24),
implemented in [PR #42](https://github.com/cliffom/gbc-scene-forge/pull/42).

- Create project-owned definitions for points, rectangles, and sprites with typed
  fields, required values, shared defaults, numeric ranges, and string choices.
- Place linked instances, override individual fields, and reset overrides to the
  current shared defaults. Definition edits preserve unsaved canvas edits and
  scene undo/redo history.
- Inspect validation findings for missing definitions, incompatible types, unknown
  fields, and constraint violations; navigate to the affected layer and object.
  Hidden layers participate in validation.
- Preserve authored overrides when a definition changes, including mismatched
  numeric types, so unrelated inspector edits remain available.
- Detach instances while preserving all effective values, including the full
  supported combination of 128 defaults and 128 explicit overrides.
- Persist links and overrides in native projects and portable Tiled properties.
  Exports include the definition library and current effective values without
  rewriting source maps. Existing version 1 projects open without migration.
- Guard definition updates and validation with revision checks, mutation tokens,
  and durable recovery.

See the [object definitions guide](STANDALONE.md#reusable-object-definitions)
for editing, validation, and Tiled interoperability details.

The Python package remains dependency-free at runtime and supports Python 3.10+.
Publication follows [RELEASING.md](RELEASING.md).
