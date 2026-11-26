"""Native illustration budgets, separate from tile grids and animation sheets."""

from gbc_scene_forge.core.validation import integer, require

# Tile and animation-sheet geometry uses eight-pixel alignment, unlike static sprites.
GRID_UNIT = 8
MAX_GRID_AXIS = 256
MAX_AXIS = 4096
MAX_PIXELS = 4_194_304
MAX_RGBA_BYTES = MAX_PIXELS * 4  # 16 MiB decoded RGBA8.
MAX_RGBA_BASE64 = 4 * ((MAX_RGBA_BYTES + 2) // 3)
MAX_IMAGE_BYTES = 17 * 1024 * 1024  # Incompressible RGBA PNG plus framing.
MAX_CANDIDATE_BYTES = 24 * 1024 * 1024  # Base64 pixels plus bounded metadata.
MAX_READ_PIXELS = 65_536  # Read larger documents through explicit rectangles.
MAX_DRAFT_BYTES = 49 * 1024 * 1024  # Original and edited envelopes plus record metadata.
MAX_REQUEST_BYTES = 50 * 1024 * 1024  # HTTP artwork checkpoints contain both envelopes.


def check(width, height):
    require(
        integer(width, 1, MAX_AXIS) and integer(height, 1, MAX_AXIS),
        "Artwork axes must be integer pixels within 1..4096",
    )
    require(width * height <= MAX_PIXELS, "Artwork area must be at most 4194304 pixels")


def grid_canvas(width, height):
    require(
        integer(width, GRID_UNIT, MAX_GRID_AXIS)
        and integer(height, GRID_UNIT, MAX_GRID_AXIS)
        and width % GRID_UNIT == height % GRID_UNIT == 0,
        "Tile/sheet dimensions must be multiples of eight within 8..256",
    )
