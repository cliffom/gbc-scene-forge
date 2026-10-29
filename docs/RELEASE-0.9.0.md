# Scene Forge 0.9.0

This release completes [#26](https://github.com/cliffom/gbc-scene-forge/issues/26):
start a useful scene without preparing artwork or using the development setup.

- Choose **Sample artwork and scenes** during project creation for your own named
  copy of the bundled sample. Copies have independent project identities, preserve
  the original template, and are never reset automatically.
- Follow the optional **First scene guide** through creation, import, painting,
  save/reopen, sprite preview and Tiled ZIP export. Close it to edit and reopen it
  from the header. Browser-local progress can be resumed or restarted.
- The installed `gbc-scene-forge` command opens the default browser after the
  loopback server binds. Use `--no-browser` for headless/manual launches and
  `--port 0` for an available port. Browser-launch failures leave a usable printed
  URL; occupied ports and permission errors offer corrective steps.

Install with Python 3.10+:

```sh
python -m pip install --upgrade gbc-scene-forge==0.9.0
gbc-scene-forge
```

A current desktop browser is required. Editing the bundled sample and following
the guide work offline after installation, with no Node, Poetry, gbc-atlas or
Tiled installation. Plain PNG/Tiled import remains tracked separately in #25.
No project schema migration or new runtime dependencies are required.

Acceptance covers creating a named sample, painting a new scene, reopening its
saved tiles, playing a sprite preview and downloading a portable ZIP. Installed
wheel smoke checks additionally start the CLI and create a sample through its
HTTP API. See the [first-use guide](STANDALONE.md#first-scene-guide) for validation,
remaining requirements and the tested platform matrix.
