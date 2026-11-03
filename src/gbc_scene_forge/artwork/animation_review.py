"""Bounded, exact-RGBA APNG reviews with literal frame timings and loop semantics."""

import struct
import zlib

from gbc_scene_forge.artwork import editable, png
from gbc_scene_forge.artwork.review import isolated
from gbc_scene_forge.core.validation import integer, require


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def render(candidate, sequence_id, scale):
    pixels = editable.check_candidate(candidate)
    descriptor = candidate["descriptor"]
    require(descriptor["version"] == 2, "Animation reviews require a native sheet")
    require(integer(scale, 1, 16), "Review scale must be within 1..16")
    require(isinstance(sequence_id, str), "Choose an explicit sequence ID")
    sequence = next((s for s in descriptor["sequences"] if s["id"] == sequence_id), None)
    require(sequence is not None, "Choose an existing sequence")
    indexed = {f["id"]: f for f in descriptor["frames"]}
    first = indexed[sequence["frames"][0]["frame_id"]]
    width, height = first["width"] * scale, first["height"] * scale
    require(
        width <= 1024 and height <= 1024 and width * height * len(sequence["frames"]) <= 4194304,
        "Animation review exceeds 1024 per axis or 4194304 total frame pixels; reduce scale/frames",
    )
    result = bytearray(png.SIGNATURE)
    result.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    result.extend(
        chunk(b"acTL", struct.pack(">II", len(sequence["frames"]), 0 if sequence["loop"] else 1))
    )
    counter = 0
    for index, item in enumerate(sequence["frames"]):
        frame = indexed[item["frame_id"]]
        raw_png = png.crop_rectangle(
            descriptor["width"], pixels, frame["x"], frame["y"], frame["width"], frame["height"]
        )
        raw = png.decode(raw_png)[2]
        enlarged = isolated(frame, raw, scale)["enlarged_png"]
        result.extend(
            chunk(
                b"fcTL",
                struct.pack(
                    ">IIIIIHHBB", counter, width, height, 0, 0, item["duration_ms"], 1000, 0, 0
                ),
            )
        )
        counter += 1
        offset = 8
        while offset < len(enlarged):
            size = struct.unpack(">I", enlarged[offset : offset + 4])[0]
            if enlarged[offset + 4 : offset + 8] == b"IDAT":
                data = enlarged[offset + 8 : offset + 8 + size]
                if index == 0:
                    result.extend(chunk(b"IDAT", data))
                else:
                    result.extend(chunk(b"fdAT", struct.pack(">I", counter) + data))
                    counter += 1
            offset += size + 12
    result.extend(chunk(b"IEND", b""))
    require(len(result) <= 16 * 1024 * 1024, "Animation review exceeds 16 MiB")
    return {
        "candidate_revision": candidate["revision"],
        "sequence_id": sequence_id,
        "frames": sequence["frames"],
        "loop": sequence["loop"],
        "scale": scale,
        "width": width,
        "height": height,
        "animation_png": bytes(result),
    }
