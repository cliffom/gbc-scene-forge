"""Dependency-free bitmap labels and exact nearest-neighbor contact-sheet cells."""

# Original 5x7 glyphs for the fixed inspection vocabulary, coordinates and SHA-256 IDs.
# Rows are five-bit masks; lowercase labels use the same legible uppercase shapes.
_GLYPHS = {
    "0": (14, 17, 19, 21, 25, 17, 14),
    "1": (4, 12, 4, 4, 4, 4, 14),
    "2": (14, 17, 1, 2, 4, 8, 31),
    "3": (30, 1, 1, 14, 1, 1, 30),
    "4": (2, 6, 10, 18, 31, 2, 2),
    "5": (31, 16, 16, 30, 1, 1, 30),
    "6": (14, 16, 16, 30, 17, 17, 14),
    "7": (31, 1, 2, 4, 8, 8, 8),
    "8": (14, 17, 17, 14, 17, 17, 14),
    "9": (14, 17, 17, 15, 1, 1, 14),
    "A": (14, 17, 17, 31, 17, 17, 17),
    "B": (30, 17, 17, 30, 17, 17, 30),
    "C": (14, 17, 16, 16, 16, 17, 14),
    "D": (30, 17, 17, 17, 17, 17, 30),
    "E": (31, 16, 16, 30, 16, 16, 31),
    "F": (31, 16, 16, 30, 16, 16, 16),
    "G": (14, 17, 16, 23, 17, 17, 15),
    "H": (17, 17, 17, 31, 17, 17, 17),
    "I": (14, 4, 4, 4, 4, 4, 14),
    "J": (7, 2, 2, 2, 18, 18, 12),
    "K": (17, 18, 20, 24, 20, 18, 17),
    "L": (16, 16, 16, 16, 16, 16, 31),
    "M": (17, 27, 21, 21, 17, 17, 17),
    "N": (17, 25, 21, 19, 17, 17, 17),
    "O": (14, 17, 17, 17, 17, 17, 14),
    "P": (30, 17, 17, 30, 16, 16, 16),
    "Q": (14, 17, 17, 17, 21, 18, 13),
    "R": (30, 17, 17, 30, 20, 18, 17),
    "S": (15, 16, 16, 14, 1, 1, 30),
    "T": (31, 4, 4, 4, 4, 4, 4),
    "U": (17, 17, 17, 17, 17, 17, 14),
    "V": (17, 17, 17, 17, 17, 10, 4),
    "W": (17, 17, 17, 21, 21, 21, 10),
    "X": (17, 17, 10, 4, 10, 17, 17),
    "Y": (17, 17, 10, 4, 4, 4, 4),
    "Z": (31, 1, 2, 4, 8, 16, 31),
    "=": (0, 0, 31, 0, 31, 0, 0),
    "@": (14, 17, 23, 21, 23, 16, 14),
    ":": (0, 4, 4, 0, 4, 4, 0),
    "(": (2, 4, 8, 8, 8, 4, 2),
    ")": (8, 4, 2, 2, 2, 4, 8),
    "/": (1, 2, 2, 4, 8, 8, 16),
    " ": (0, 0, 0, 0, 0, 0, 0),
}


class Canvas:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.pixels = bytearray(bytes([32, 36, 43, 255]) * width * height)

    def text(self, x, y, label):
        for char in label.upper():
            for row, bits in enumerate(_GLYPHS[char]):
                for column in range(5):
                    if bits & (1 << (4 - column)):
                        offset = ((y + row) * self.width + x + column) * 4
                        self.pixels[offset : offset + 4] = b"\xff\xff\xff\xff"
            x += 6

    def image(self, x, y, descriptor, raw, rectangle, scale):
        # Preserve straight RGBA (including hidden RGB) inside each image cell.
        for row in range(rectangle["height"]):
            start = ((rectangle["y"] + row) * descriptor["width"] + rectangle["x"]) * 4
            line = b"".join(
                raw[i : i + 4] * scale for i in range(start, start + rectangle["width"] * 4, 4)
            )
            for repeat in range(scale):
                offset = ((y + row * scale + repeat) * self.width + x) * 4
                self.pixels[offset : offset + len(line)] = line
