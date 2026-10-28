# Manifest v1 palette conformance examples

These native PNGs are synthetic repeating index patterns, independently authored
for metadata conformance. They contain no production art or editable-document
approval claim. Each manifest is a draft: technical validation succeeds, but
production generation/approval verification must fail. No Aseprite connection,
new schema, converter release, or runtime Python dependency is needed to read
them. All RGB5 components expand exactly as `(value * 255 + 15) // 31`.

From the repository root, with the committed Poetry environment:

```sh
poetry run gbc-atlas validate examples/palette-semantics/mixed/mixed.atlas.json
poetry run gbc-atlas validate examples/palette-semantics/bank/bank.atlas.json
poetry run gbc-atlas validate examples/palette-semantics/reordered/reordered.atlas.json
poetry run python -m unittest discover -s tests -p test_palette_semantics.py -v
```

The [format contract](../../src/gbc_atlas/skills/create-atlas/references/format.md#palette-interpretation-for-scene-consumers)
is normative. `expected.json` is a test oracle, **not an interchange format or a
new manifest field**. Its symbolic identity labels are scoped to BG or OBJ.
`identities` gives the ordered RGB5 comparison entries (four for BG, three for
OBJ). Each atlas lists all declared palette comparison labels in local-ID order,
row-major cell palettes, default encoded tile IDs, explicit region cell lists,
local IDs and distinct identities, and animation frame region names. A frame's
expected identities are those of its named region. No allocation is encoded.

Every pixel uses index `(x + y) % 4` in atlas pixel coordinates. OBJ index-zero
pixels have arbitrary transparent RGB `(231, 93, 10)`; all other pixels are
opaque exact palette expansions. This exercises every index, rather than hiding
ordering differences behind unused entries. The tests decode the resulting
2bpp bytes to check that the pattern and local IDs survive encoding.

| Bundle | Content and expected interpretation |
| --- | --- |
| `mixed` (32×16) | `ground` covers cells `[0,1,4,5]`, IDs `[0,1,0,1]`: both IDs have BG identity A. `actor_a` covers `[2,6]`, ID 2: OBJ A. `actor_b` covers `[3,7]`, ID 3: OBJ C. `walk` references `actor_a`, then `actor_b`, introducing OBJ C. Local palette 4 is unused. |
| `bank` (64×24) | `actor` covers `[0,8]`, ID 0: OBJ A, equal to `mixed` ID 2 despite different entry zero. `upper` covers columns 1–7 of rows 0–1: BG B,D,E,F,G,H,I. `strip` covers the final row: BG A,B,D,E,F,G,H,I. The atlas has an odd row count with only tiles in the last row. |
| `reordered` (8×8) | `swapped` covers cell 0: BG C, the same color set as A with visible indices 1 and 2 exchanged. It needs a distinct slot when encoded indices are preserved. |

`mixed` ID 2 and `bank` ID 0 compare equal for OBJ but differ for BG (B versus A).
`mixed` IDs 0 and 1 are repeated equivalent palettes; both declarations still
count toward the local ceiling. ID 4 is unused and contributes no selected-cell
requirement. The mixed atlas's default cell-to-tile map is `[4,5,0,2,6,7,1,3]`:
reading a palette map at an encoded tile ID would give the wrong result.
With deduplication enabled, region rectangles and palette interpretation stay
the same; tile IDs and flip flags may change. Tests exercise both modes.

## Scene selections for Forge #32

These are reproducible input selections and manually specified expectations for
[Forge #32](https://github.com/cliffom/gbc-scene-forge/issues/32), targeting its
v0.4.0 work. Import each native PNG with its adjacent manifest. All selections
below assume a static resident GBC scene, no palette streaming or mid-frame
changes, zero reservations, eight slots in each pool, tiles assigned to BG,
sprites assigned to OBJ, and all frames of the selected `walk` animation
included. Window/UI shares BG. Unknown runtime needs still require consumer
verification; zero reservations here is an explicit fixture assumption.

| Selection | Regions/animation included | Expected BG identities | Expected OBJ identities | Expected result |
| --- | --- | --- | --- | --- |
| Passing, at BG boundary | `mixed.ground`, `mixed.walk` (both frame regions), `bank.strip`, `bank.actor` | A,B,D,E,F,G,H,I (8) | A,C (2) | Fits both pools |
| Over BG budget | Passing selection plus `reordered.swapped` | A,B,C,D,E,F,G,H,I (9) | A,C (2) | BG exceeds eight by one |
| Explicit reservation | Passing selection, with one BG slot reserved | Same 8 | Same 2 | BG exceeds seven available by one |
| First-frame contrast | `mixed.ground`, only `mixed.actor_a`, `bank.strip`, `bank.actor` | Same 8 | A (1) | Demonstrates why animation closure changes the requirement |

Forge tests own aggregation, target policy, reservations, expected budget results,
and editor/preflight behavior. Atlas tests establish individual bundle validity,
exact encoding, metadata interpretation, pair constraints, and rejection of
invalid mutations. They intentionally add no scene budget engine. These
examples provide the upstream side of the cross-project contract; running them
in Forge and agreeing on its integration results remain Forge-owned work.
