"""Original MIT synthetic motif with independently declared expected cleanup coordinates."""

import json
from pathlib import Path


def fixture():
    path = Path(__file__).resolve().parents[1] / "fixtures/pixel-cleanup/motif.json"
    spec = json.loads(path.read_text())
    w, h = spec["width"], spec["height"]
    raw = bytearray(spec["background"] * (w * h))
    for r in spec["rectangles"]:
        for y in range(r["y"], r["y"] + r["height"]):
            for x in range(r["x"], r["x"] + r["width"]):
                pos = (y * w + x) * 4
                raw[pos : pos + 4] = bytes(r["rgba"])
    for pixel in spec["pixels"]:
        pos = (pixel["y"] * w + pixel["x"]) * 4
        raw[pos : pos + 4] = bytes(pixel["rgba"])
    return spec, bytes(raw)
