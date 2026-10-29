# Scene Forge 0.10.0

This release makes the editor easier to scan and gives the canvas and artwork
more room as the authoring toolset grows.

- **Scene actions** groups scene creation, renaming, duplication, resizing,
  reversion and deletion. **Project tools** groups World view, Diagnostics and
  GBC palette checks. Save and Export stay visible; palette budget warnings
  remain visible while Project tools is closed.
- The library has **Artwork**, **Objects** and **Stamps** tabs. Import, search and
  filters stay with artwork, definitions stay with objects, and stamp selection
  and placement have a dedicated panel. Refreshing artwork preserves the chosen tab.
- Dropdowns reserve space for their arrows. Long stamp names use ellipses and
  expose their full names on hover. Stamp placement has visible active feedback
  and a **Stop placing** action.
- Drawing tools retain text labels. Clipboard actions stay beside the canvas,
  while secondary transforms use a command group. Control sizes, inspector
  spacing and keyboard focus are more consistent across desktop window sizes.
- Library tabs support arrow keys and Home/End. Native command popovers support
  Tab, Enter/Space and Escape, preserve modal focus, and stay within the window.
  The first-scene guide reveals the relevant library tab when following a step.

Install with Python 3.10+:

```sh
python -m pip install --upgrade gbc-scene-forge==0.10.0
gbc-scene-forge
```

Existing projects require no migration. No new runtime dependencies are added.
The desktop layout is tested at five sizes from 760×640 to 1440×900, including a
short 1440×600 window. See the [editor guide](STANDALONE.md#editor-layout) and
[layout guidelines and visual comparison](UI-DESIGN.md).
