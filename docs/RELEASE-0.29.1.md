# Scene Forge 0.29.1

Prepared fixes for the three remaining issues in
[milestone 13](https://github.com/cliffom/gbc-scene-forge/milestone/13).
Tagging and publication remain separate.

- Artwork search matches displayed names such as `hero idle` and raw IDs such
  as `hero_idle` or `sample/hero_idle`, case-insensitively. Atlas and kind filters
  still combine with search, without changing scene editing state.
- Successful PNG/Tiled checks replace prior check errors with confirmation
  guidance. Replies for changed inputs, closed dialogs or disposed editors cannot
  restore stale previews or errors. Confirmation still requires a current check.
- The Library entry says **Import artwork or map…**. Empty-Library guidance and
  the first-scene guide name the supported sources: gbc-atlas bundles, PNG
  tilesheets, Tiled JSON maps and Forge export ZIPs.

Project formats, import compatibility, source ownership, revision guards and
explicit confirmation are unchanged. Existing projects need no migration.
See [import guidance](user/import-artwork.md) and [validation](VALIDATION.md).
