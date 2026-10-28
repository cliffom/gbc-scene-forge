"""Independent PNG encodings exercise every filter and packed palette indices."""

import struct
import unittest
import zlib

from gbc_scene_forge.png import decode


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def container(depth, color, rows, extra=b"", interlace=0):
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, depth, color, 0, 0, interlace))
        + extra
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


class PngTests(unittest.TestCase):
    def test_rgb_and_rgba_filters(self):
        for channels in (3, 4):
            for method in range(5):
                with self.subTest(channels=channels, method=method):
                    rows, pixels = bytearray(), bytearray()
                    previous = bytes(8 * channels)
                    for y in range(8):
                        samples = bytes((x * 17 + y * 23) % 256 for x in range(8 * channels))
                        encoded = bytearray([method])
                        for i, value in enumerate(samples):
                            left = samples[i - channels] if i >= channels else 0
                            up = previous[i]
                            upper_left = previous[i - channels] if i >= channels else 0
                            prediction = left + up - upper_left
                            # Independent branch implementation of the PNG Paeth rule.
                            a, b, c = (abs(prediction - v) for v in (left, up, upper_left))
                            paeth = left if a <= b and a <= c else up if b <= c else upper_left
                            predictor = [0, left, up, (left + up) // 2, paeth][method]
                            encoded.append((value - predictor) % 256)
                        rows.extend(encoded)
                        for x in range(8):
                            pixels.extend(samples[x * channels : x * channels + 3])
                            pixels.append(samples[x * channels + 3] if channels == 4 else 255)
                        previous = samples
                    self.assertEqual(
                        decode(container(8, 6 if channels == 4 else 2, rows)), (8, 8, bytes(pixels))
                    )

    def test_packed_indexed_images_and_transparency(self):
        for depth in (1, 2, 4, 8):
            with self.subTest(depth=depth):
                count = min(1 << depth, 8)
                palette = bytes(v for index in range(count) for v in (index * 30,) * 3)
                alpha = bytes([0] + [255] * (count - 1))
                samples = [x % count for x in range(8)]
                packed = bytearray(8 * depth // 8)
                for x, index in enumerate(samples):
                    packed[x * depth // 8] |= index << (8 - depth - x * depth % 8)
                encoded = container(
                    depth, 3, (b"\0" + packed) * 8, chunk(b"PLTE", palette) + chunk(b"tRNS", alpha)
                )
                expected_row = bytes(
                    v for index in samples for v in (*([index * 30] * 3), alpha[index])
                )
                self.assertEqual(decode(encoded)[2], expected_row * 8)

    def test_bad_filters_lengths_and_interlace(self):
        for encoded in (
            container(8, 2, (b"\5" + bytes(24)) * 8),
            container(8, 2, bytes(100000)),
            container(8, 2, bytes(200), interlace=1),
            container(16, 2, bytes(200)),
        ):
            with self.subTest(encoded=encoded), self.assertRaises(ValueError):
                decode(encoded)
