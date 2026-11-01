"""Native scene allocation limits, checked before constructing cell arrays."""

from gbc_scene_forge.core.validation import integer, require

MAX_CELLS = 65_536
MAX_PIXELS = 8192


def check_dimensions(width, height, grid):
    require(type(grid) is int and grid in (8, 16, 32), "Choose an 8, 16 or 32 pixel grid")
    require(
        integer(width, 1, MAX_PIXELS // grid) and integer(height, 1, MAX_PIXELS // grid),
        "Scene dimensions must be positive whole cells and at most 8192 pixels per axis",
    )
    require(width * height <= MAX_CELLS, "Scene area must be at most 65536 cells")
