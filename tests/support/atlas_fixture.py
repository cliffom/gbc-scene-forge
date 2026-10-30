"""Independent tiny gbc-atlas bundle fixture, using only the standard library."""

import json
import struct
import zlib


def image(width=16, height=8, rgb=(0, 0, 0), *, indexed=False):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 3 if indexed else 2, 0, 0, 0)
    rows = (b"\0" + (b"\0" if indexed else bytes(rgb)) * width) * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + (chunk(b"PLTE", bytes(rgb)) if indexed else b"")
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def bundle(root, atlas_id="terrain", *, rgb=(0, 0, 0), indexed=False):
    root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "id": atlas_id,
        "png": "atlas.png",
        "palettes": [[[0, 0, 0], [10, 10, 10], [20, 20, 20], [31, 31, 31]]],
        "cell_palettes": [0, 0],
        "regions": [
            {"name": "earth", "kind": "tile", "x": 0, "y": 0, "width": 8, "height": 8},
            {"name": "stone", "kind": "tile", "x": 8, "y": 0, "width": 8, "height": 8},
        ],
        "animations": [
            {
                "name": "cycle",
                "frames": [
                    {"region": "earth", "duration_ms": 100},
                    {"region": "stone", "duration_ms": 200},
                ],
            }
        ],
        "source": "optional.aseprite",
        "placement": "Fixture metadata",
    }
    path = root / f"{atlas_id}.atlas.json"
    path.write_text(json.dumps(manifest))
    (root / "atlas.png").write_bytes(image(rgb=rgb, indexed=indexed))
    return path, manifest


def sprite_bundle(root, atlas_id="actors"):
    path, manifest = bundle(root, atlas_id)
    manifest["cell_palettes"] = [0] * 8
    manifest["regions"] = [
        {
            "name": "idle",
            "kind": "sprite",
            "x": 0,
            "y": 0,
            "width": 16,
            "height": 32,
            "origin": [8, 23],
            "duration_ms": 120,
        }
    ]
    manifest["animations"] = [{"name": "idle", "frames": [{"region": "idle"}]}]
    path.write_text(json.dumps(manifest))

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    rows = b"".join(
        b"\0"
        + b"".join(
            bytes([255, 255, 255, 255]) if 4 <= x < 12 and 4 <= y < 24 else bytes(4)
            for x in range(16)
        )
        for y in range(32)
    )
    (root / "atlas.png").write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 32, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )
    return path, manifest
