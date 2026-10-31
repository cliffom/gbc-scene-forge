# Scene Forge 0.19.1

New saved projects and registered scenes appear automatically in the browser's
project chooser and navigation dropdowns. Scene choices can update while the
active scene has unsaved work, without changing its canvas, history, recovery
checkpoint or saved revision. Opening a discovered scene uses the existing
unsaved-change confirmation and revision guards.

Discovery shares the existing two-second refresh cycle. It pauses for hidden
tabs, open dialogs/popovers and active dropdown interactions, and checks again on
focus or reconnect. Auto-refresh and manual-check controls apply to discovery too.
Changed project manifests and scene maps use the existing validators; invalid or
incomplete entries are reported, and repaired files are detected automatically.
Unregistered map files are not imported automatically.

Unchanged checks stat project manifests and registered scene maps and reuse
validated inventories without decoding scenes or reading artwork. Work scales
with the number of projects and registered scenes; a changed manifest may require
revalidating its scenes. See [external refresh](user/external-refresh.md).

This patch fixes the existing external-refresh workflow. Existing project, Tiled
and draft formats and required runtime dependencies are unchanged. Release
preparation does not publish the package.
