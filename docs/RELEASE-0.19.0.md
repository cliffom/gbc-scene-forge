# Scene Forge 0.19.0

Opened scenes now have a stable scene ID in the URL path. Copy, bookmark, reload
or open a link in another tab to return directly to that scene's current saved
state. Both the project root launcher and direct project server support these
links. See [scene links](user/scene-links.md) for route examples and navigation.

Browser Back and Forward revisit scenes and the scene chooser, with confirmation
before discarding unsaved changes. Missing or invalid scene links leave the
scene chooser available. Existing conflict-aware draft recovery remains available;
links do not serialize unsaved edits or pin old revisions.

This minor release prepares 0.19.0 for a new browser capability. Existing project,
Tiled and draft formats and required runtime dependencies are unchanged.
Publication is a separate step.
