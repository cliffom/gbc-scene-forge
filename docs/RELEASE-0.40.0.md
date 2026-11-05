# Scene Forge 0.40.0

Make artwork setup easier to understand and browse (#237), following direct
feedback on the 0.39.0 New artwork screen.

## Changes

- Start New artwork with its creation form. Use **More options** for identity,
  sheet configuration and complete limits.
- Separate **New artwork**, **Existing artwork** and **From agent** into padded,
  keyboard-accessible tabs. Agent availability adds a count without opening or
  displacing creation.
- Browse agent drafts as visual cards. Open a larger read-only preview, then
  explicitly **Edit a copy** with independent local ownership and Undo history.
- Separate preview from **Download PNG** and **Download snapshot JSON**. Keep
  technical identities under **Draft details**, with retry and stale-base guidance.
- Hide the shared editing toolbar during setup and browsing. Restore contextual
  commands when an editable document opens, preserving retained histories.

## Upgrade and compatibility

```sh
python -m pip install --upgrade gbc-scene-forge==0.40.0
python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.40.0'
```

This compatible editor feature release adds no mandatory runtime dependencies and
changes no project/Tiled/MCP schemas. Existing source editing/copies, multi-frame
creation and recovery remain supported. Agent drafts remain unpublished until an
explicit reviewed save; existing saved-base and selected-placement guards apply.
PNG is flattened static RGBA; native snapshot JSON retains editable data.
See [artwork workflows](user/pixel-artwork.md), [UI guidelines](UI-DESIGN.md),
[validation](VALIDATION.md) and [release procedure](RELEASING.md).
Release preparation is separate from tagging and publication.
