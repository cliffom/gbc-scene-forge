# Scene Forge 0.3.5

## Recover unsaved scene edits

Unsaved canvas edits now checkpoint automatically inside the project. Reopen the
project after a browser crash, server restart, port change, or project move to
restore, download, discard, or defer recovery. Restoring keeps the saved scene
intact until you choose Save; Revert returns to the committed content.

Each tab owns an independent checkpoint. Revision guards preserve existing newer
content, and live tabs resume under a new identity if another tab removes their
checkpoint. Cleanup resolves lost write acknowledgements before deleting drafts,
so explicitly discarded edits do not reappear in recovery. Failed writes show a
message and retry automatically; smaller edits can replace oversized snapshots.

Checkpoints are bounded to 4 MiB each, 64 records, and 64 MiB per project. They
remain local recovery data and are excluded from portable exports. Stale or
incompatible drafts remain downloadable without overwriting external changes.
Animation playback and movement-preview positions remain transient.

Atlas deletion also keeps the committed scene revision synchronized so editing
and saving continue to work after Revert.

## Compatibility and installation

Project manifests remain version 1. Python 3.10+ is supported, and the installed
editor needs neither Node nor additional Python runtime dependencies.

```sh
python -m pip install --upgrade gbc-scene-forge==0.3.5
gbc-scene-forge
```

Implemented in [PR #38](https://github.com/cliffom/gbc-scene-forge/pull/38),
closing [#22](https://github.com/cliffom/gbc-scene-forge/issues/22).
