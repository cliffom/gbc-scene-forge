"""Bounded non-interlaced RGB/RGBA/indexed PNG reader for atlases and generic sheets."""

import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def encode(width, height, pixels):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    rows = b"".join(b"\0" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    return (
        SIGNATURE
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def decode(data, *, generic=False):
    if not data.startswith(SIGNATURE) or len(data) > 4 * 1024 * 1024:
        raise ValueError("Expected a PNG atlas no larger than 4 MiB")
    offset, chunks, ended = 8, {}, False
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        if (
            offset + length + 12 > len(data)
            or zlib.crc32(kind + payload) != struct.unpack_from(">I", data, offset + 8 + length)[0]
        ):
            raise ValueError("Invalid PNG chunk")
        if not chunks and kind != b"IHDR":
            raise ValueError("PNG must start with IHDR")
        if kind in (b"IHDR", b"PLTE", b"tRNS") and kind in chunks:
            raise ValueError("Duplicate PNG metadata")
        chunks.setdefault(kind, bytearray()).extend(payload)
        offset += length + 12
        if kind == b"IEND":
            ended = True
            break
        if kind not in (b"IHDR", b"PLTE", b"IDAT", b"tRNS") and not kind[0] & 32:
            raise ValueError("Unsupported critical PNG chunk")
    if not ended or offset != len(data) or len(chunks.get(b"IHDR", b"")) != 13:
        raise ValueError("Incomplete PNG")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", chunks[b"IHDR"]
    )
    if generic:
        if not (1 <= width <= 2048 and 1 <= height <= 2048):
            raise ValueError("PNG dimensions must be within 1..2048")
    elif not (8 <= width <= 256 and 8 <= height <= 256 and width % 8 == height % 8 == 0):
        raise ValueError("Atlas dimensions must be multiples of eight within 8..256")
    if (
        compression
        or filtering
        or interlace
        or not ((color in (2, 6) and depth == 8) or (color == 3 and depth in (1, 2, 4, 8)))
    ):
        raise ValueError("Use a non-interlaced RGB/RGBA 8-bit or indexed PNG")
    channels = {2: 3, 3: 1, 6: 4}[color]
    stride = (width * channels * depth + 7) // 8
    step = max(1, channels * depth // 8)
    expected = (stride + 1) * height
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(bytes(chunks.get(b"IDAT", b"")), expected + 1)
    except zlib.error as error:
        raise ValueError("Invalid compressed PNG") from error
    if len(raw) != expected or not inflater.eof or inflater.unused_data:
        raise ValueError("Invalid PNG pixel length")
    palette, alpha = chunks.get(b"PLTE", b""), chunks.get(b"tRNS", b"")
    if color == 3 and (not palette or len(palette) % 3 or len(palette) > 768):
        raise ValueError("Invalid indexed PNG palette")
    if color == 2 and alpha and len(alpha) != 6:
        raise ValueError("Invalid RGB PNG transparency")
    if color == 6 and alpha:
        raise ValueError("RGBA PNG cannot declare tRNS")
    pixels, previous = bytearray(), bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        method = raw[start]
        row = bytearray(raw[start + 1 : start + 1 + stride])
        if method > 4:
            raise ValueError("Invalid PNG filter")
        for i in range(stride):
            a, b, c = (
                (row[i - step] if i >= step else 0),
                previous[i],
                (previous[i - step] if i >= step else 0),
            )
            p = a + b - c
            distances = (abs(p - a), abs(p - b), abs(p - c))
            paeth = (a, b, c)[distances.index(min(distances))]
            row[i] = (row[i] + (0, a, b, (a + b) // 2, paeth)[method]) & 255
        for x in range(width):
            if color == 3:
                index = (row[x * depth // 8] >> (8 - depth - (x * depth % 8))) & ((1 << depth) - 1)
                if index * 3 + 3 > len(palette):
                    raise ValueError("PNG palette index outside palette")
                pixels.extend(palette[index * 3 : index * 3 + 3])
                pixels.append(alpha[index] if index < len(alpha) else 255)
            else:
                sample = row[x * channels : (x + 1) * channels]
                pixels.extend(sample[:3])
                transparent = color == 2 and alpha and tuple(sample) == struct.unpack(">HHH", alpha)
                pixels.append(sample[3] if color == 6 else 0 if transparent else 255)
        previous = row
    return width, height, bytes(pixels)


def crop(width, pixels, x, y, size):
    return crop_rectangle(width, pixels, x, y, size, size)


def crop_rectangle(width, pixels, x, y, crop_width, crop_height):
    return encode(
        crop_width,
        crop_height,
        b"".join(
            pixels[((y + row) * width + x) * 4 : ((y + row) * width + x + crop_width) * 4]
            for row in range(crop_height)
        ),
    )
