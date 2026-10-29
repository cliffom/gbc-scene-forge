# Scene Forge 0.16.0

Review optional GBC tile and sprite estimates without changing generic authoring.
See the [GBC budgets guide](user/gbc-budgets.md) for setup and assumptions.

- Extend existing palette profiles with static layout v1: unsigned BG tiles in
  bank 0 and OBJ tiles in bank 1, declared reservations, and 8×8 or 8×16 sprites.
- Report unique source 8×8 cells and rectangular metasprite OAM estimates, including
  hidden layers and linked animation frames. Expand contributors to locate artwork.
- Surface estimates in project diagnostics; unknown metadata and reservations are
  explicitly unverified. Runtime allocation, camera/scanline behavior and timing
  remain unverified even when estimates fit. Generic editing/export is never blocked.
- Existing palette-only profiles remain compatible. Enabling hardware estimates
  writes optional profile version 2; use Forge 0.16.0 or later thereafter. Target
  settings stay in the Forge manifest, outside portable Tiled maps and tilesets.
- No required runtime dependency or manifest migration is introduced.

Install with `python -m pip install --upgrade gbc-scene-forge==0.16.0`, or use
`'gbc-scene-forge[mcp]==0.16.0'` for the optional MCP extra. Existing MCP diagnostics
include target findings when enabled; author profile settings in the browser.
