# Scene Forge 0.3.3

## Running build version

The project selector and editor now show the running app version at the right
end of the existing status row. The static LOCAL PROJECT and TILED JSON labels
have been removed from that row to make room for the version.

The server prints the same version above Project Root at startup. Production
builds show `0.3.3`; development builds append the build's Git commit, such as
`0.3.3-a1b2c3d`. Both displays use identity embedded at build time, including in
installed packages. See [build configuration](RELEASING.md#ui-build-identity).

## Compatibility and installation

Manifest schema remains version 1. Existing projects need no format migration.
Python 3.10+ is supported, with no additional runtime dependencies or Node
requirement for the installed editor.

```sh
python -m pip install --upgrade gbc-scene-forge==0.3.3
gbc-scene-forge
```

See the [README](../README.md) for setup and the
[editor guide](STANDALONE.md) for controls and project storage.
