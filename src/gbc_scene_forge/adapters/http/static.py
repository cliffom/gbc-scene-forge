"""Explicit bundled-file allowlist shared by project and workspace HTTP handlers."""

from .common import STATIC
from .routes import Response

# Never derive a filesystem path from an arbitrary request path.
STATIC_FILES = {
    "/": ("project.html", "text/html"),
    "/project.js": ("project.js", "text/javascript"),
    "/project.js.map": ("project.js.map", "application/json"),
    "/project.css": ("project.css", "text/css"),
    "/style.css": ("style.css", "text/css"),
    "/branding/logo-64.png": ("branding/logo-64.png", "image/png"),
    "/branding/favicon-32.png": ("branding/favicon-32.png", "image/png"),
    "/branding/favicon-16.png": ("branding/favicon-16.png", "image/png"),
    "/apple-touch-icon.png": ("branding/apple-touch-icon.png", "image/png"),
    "/apple-touch-icon-precomposed.png": ("branding/apple-touch-icon.png", "image/png"),
}


def static_response(route: str, *, charset: bool) -> Response | None:
    entry = STATIC_FILES.get(route)
    if entry is None:
        return None
    filename, content_type = entry
    if charset and content_type != "image/png":
        content_type += "; charset=utf-8"
    return Response(STATIC.joinpath(filename).read_bytes(), content_type)
