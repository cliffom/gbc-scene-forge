# Native sheets and unified artwork authoring (milestone 15)

## Scope and method

Evaluated in the prepared 0.29.0 working tree on `milestone/15`, based on
[`bbdfb8a`](https://github.com/cliffom/gbc-scene-forge/commit/bbdfb8a69c20ceb740fd08977f431cbaf4ef5b44),
on 2026-11-02 local time (2026-11-03 UTC), macOS arm64, Python 3.13.13,
Node 24.22.1, Playwright 1.64.1 and the optional MCP SDK 1.30.0.
This is synthetic service/browser acceptance and agent image inspection; no
human usability study or model art-generation benchmark was performed.
Final command outcomes belong in [Validation](../VALIDATION.md).

## Representative compact payload measurement (#148)

A disposable empty project was created with `Project.create`. Through the MCP
`Adapter`, `create_artwork` prepared a transparent 16×32 sprite named `Player`,
atlas `player`, origin `[8,26]`, default region `artwork`. `retain_artwork_candidate`
returned its compact handle. Both paths edited pixel `(1,1)` to `[77,88,99,0]`.
The compact path reviewed at scale 1, committed with the returned receipt and
reopened; its full RGBA matched the edited envelope exactly.

Sizes below count UTF-8 bytes from Python
`json.dumps(value,separators=(',',':'),ensure_ascii=False)`. Arguments include
`project:"project"`, the candidate, and the same writes or receipt as applicable.
Responses count structured candidate data; JSON-RPC/MCP framing, duplicated text
content, PNG resources and tokenizer-specific tokens are excluded. UUIDs and
hashes have fixed lengths. The full envelope carries 2,048 raw pixel bytes
(2,732 base64 characters), including hidden RGB, in both modes.

| Payload | Full envelope bytes | Compact bytes | Reduction |
| --- | ---: | ---: | ---: |
| Initial candidate | 3,339 | 293 | 91.2% |
| One-pixel edit arguments | 3,418 | 372 | 89.1% |
| Edited candidate response | 3,339 | 293 | 91.2% |
| Review arguments | 3,373 | 327 | 90.3% |
| Commit arguments with identical receipt | 3,845 | 799 | 79.2% |

These are one representative static sprite's measurements, not throughput or
model-token benchmarks. Frame/sequence descriptors increase full sheet payloads;
handles keep the same fields. Ordinary review resources/receipts are unchanged.
Explicit full-pixel reads/export still carry requested pixel data. Compact mode
trades project-local storage for smaller repeated payloads: 256 immutable records,
64 MiB total, no expiration or automatic eviction. Restart recovery, quotas,
corruption and stale-base export are covered in
[MCP sheet acceptance](../../tests/backend/adapters/test_mcp_sheets.py).

## Acceptance coverage

- [Domain workflows](../../tests/backend/artwork/test_authoring_workflows.py)
  compose transparent tree, vine and rounded platform tiles over opaque scenery;
  compare rendered PNGs after reopen and portable export; retain hidden RGB;
  migrate generic tiles and animated sprites losslessly; verify APNG frame timing,
  non-looping playback metadata and limits; transfer embedded sheet identities;
  and review/commit selected sprite-to-tile mapping with untouched references,
  drawing order, stale/tampered reviews and rejected misalignment.
- [Sheet persistence](../../tests/backend/artwork/test_sheets.py) covers frame
  reorder/rename, append-only local IDs, saved geometry protection, descriptor
  limits and stale revisions. Existing artwork transaction/recovery suites retain
  failed writes, stale reviews, exact acknowledgments and ambiguous-write guards.
- [MCP sheet acceptance](../../tests/backend/adapters/test_mcp_sheets.py) exercises
  compact create/edit/read/review/commit/reopen, immutable old handles, restart
  discovery and exact handoff. Its actual SDK test discovers strict nested
  schemas, reads an APNG resource and reopens saved hidden RGB and timing.
- [Browser pixel acceptance](../../tests/playwright/artwork/pixels.spec.ts)
  creates a player sheet and idle/walk/jump/duck sequences with pointer tools;
  changes timing/looping, plays/steps and uses onion skinning; retains dirty
  scene/artwork histories and view state; opens an agent-created sheet without a
  scene, corrects pixels/timing and continues from that exact saved revision;
  authors/repeats/places tiles and explicitly converts selected sprites.
  Existing scenarios cover keyboard, checkpoints, external drift, stale saves
  and lost acknowledgments. Automated manual-only means those scenarios use
  browser authoring controls; the fixture setup remains scripted.

## Visual review and limitations

The workspace shares Library and document navigation, with pixel tools above the
canvas and frame/sequence controls beside it. At 800×640, the canvas and inspector
scroll independently, while save controls remain reachable.
Retained screenshots are linked from the [user guide](../user/pixel-artwork.md).

The first broad browser run exposed a new navigation row reducing the available
canvas height and a Library test counting newly added Open buttons as assets.
The layout bounds and asset-specific test selector were corrected, with focused
regression checks before the final suite. An initial migration fixture incorrectly
requested transparent pixels through the strict external atlas intake; the test
now uses supported generic RGBA PNG intake. These early failures are distinct
from final passing checks.

A strengthened sheet handoff check exposed stale timeline callbacks after
Undo/Redo replaced a descriptor with identical serialized content. Timing edits
could target the detached snapshot. The inspector now binds callbacks again when
descriptor identity changes. The regression explicitly verifies saved 333 ms
timing, an additional agent pixel edit, exact retained manual/hidden pixels, and
browser reopening after the agent commit.

The fixtures demonstrate exact authoring and handoff, not production art quality
or prolonged drawing comfort. Saved frame geometry is protected; changing it
requires a fresh document/layout. Conversion handles exact, grid-aligned static
poses and explicitly retains source animation definitions. Plain Tiled cannot
represent every sequence; [the contract](../UNIFIED-EDITOR-DESIGN.md) describes
reported skips and retained metadata. No official Tiled application, Windows,
non-Chromium, physical-device or screen-reader assessment was performed here.
Outstanding checks stay in the
[single maintained list](../VALIDATION.md#remaining-checks).
