"""Check repository documentation links and record structure without dependencies."""

from __future__ import annotations

import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlsplit

VALIDATION = "docs/VALIDATION.md"
CHANGELOG = "docs/CHANGELOG.md"
ROADMAP = "docs/ROADMAP.md"
RELEASING = "docs/RELEASING.md"
INDEX = "docs/README.md"
POLICY = "docs/DOCUMENTATION.md"
REQUIRED = {"README.md", "AGENTS.md", VALIDATION, CHANGELOG, ROADMAP, RELEASING, INDEX, POLICY}
FIELDS = ("Scope", "Method", "Result", "Limits")
CHECKBOX = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]", re.M)
HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$", re.M)
VERSION = r"\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?"
RELEASE_TITLE = re.compile(rf"({VERSION})(?: — .+)?$")
RELEASE_HISTORY = re.compile(r"(?:release\s+)?v?\d+\.\d+(?:\.|\b)", re.I)
LINK = re.compile(r"!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+\"[^\"\n]*\")?\s*\)")
REFERENCE = re.compile(r"^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|\S+)", re.M)


def prose(text: str) -> str:
    """Remove fenced examples, preserving line breaks and inline code in headings."""
    result = []
    fence = None
    for line in text.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line.rstrip("\r\n"))
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                if not marker[2].strip():
                    fence = None
            result.append("\n")
        elif marker:
            fence = marker[1]
            result.append("\n")
        else:
            result.append(line)
    return "".join(result)


def headings(text: str) -> list[tuple[int, str]]:
    return [(len(match[1]), match[2]) for match in HEADING.finditer(prose(text))]


def anchors(text: str) -> set[str]:
    ids: set[str] = set()
    for _, title in headings(text):
        title = re.sub(r"<[^>]*>", "", title).lower()
        slug = "".join(
            char for char in title if char in " _-" or unicodedata.category(char)[0] in "LN"
        ).replace(" ", "-")
        anchor = slug
        suffix = 0
        while anchor in ids:
            suffix += 1
            anchor = f"{slug}-{suffix}"
        ids.add(anchor)
    ids.update(re.findall(r"<a\s+(?:id|name)=[\"\']([^\"\']+)", prose(text), re.I))
    return ids


def sections(text: str) -> list[tuple[str | None, str]]:
    """Level-two entries own their subheadings; the preamble has no title."""
    text = prose(text)
    starts = [match for match in HEADING.finditer(text) if len(match[1]) == 2]
    result: list[tuple[str | None, str]] = []
    start = 0
    title = None
    for match in starts:
        result.append((title, text[start : match.start()]))
        title = match[2]
        start = match.end()
    result.append((title, text[start:]))
    return result


def destinations(text: str) -> list[str]:
    # Inline code examples are not links. Reference definitions are checked even
    # if unused, so stale reference destinations cannot silently accumulate.
    text = re.sub(r"(`+).*?\1", "", prose(text))
    return [m[1].strip("<>") for m in LINK.finditer(text)] + [
        m[2].strip("<>") for m in REFERENCE.finditer(text)
    ]


def local_target(root: Path, name: str, destination: str) -> tuple[str, str] | None:
    url = urlsplit(destination)
    if url.scheme or url.netloc:
        return None
    path = unquote(url.path)
    if path.startswith("/") or "\\" in path:
        raise ValueError("use a relative link within the repository")
    target = (root / name).parent / path if path else root / name
    try:
        relative = target.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("use a relative link within the repository") from exc
    return relative, unquote(url.fragment)


def ledger_errors(documents: dict[str, str]) -> list[str]:
    errors = []
    entries = sections(documents.get(VALIDATION, ""))
    if sum(title == "Remaining checks" for title, _ in entries) != 1:
        errors.append(f"{VALIDATION}: require one Remaining checks section")
    evidence = [title for title, _ in entries if title not in (None, "Remaining checks")]
    if not evidence:
        errors.append(f"{VALIDATION}: require a scoped evidence entry")
    for title, body in entries:
        if title == "Remaining checks":
            continue
        if CHECKBOX.search(body):
            errors.append(f"{VALIDATION}: {title or 'preamble'}: tasks belong in Remaining checks")
        if title is None:
            continue
        fields = re.findall(r"^- \*\*(Scope|Method|Result|Limits):\*\*([^\n]*)", body, re.M)
        if tuple(label for label, _ in fields) != FIELDS or any(
            not value.strip() for _, value in fields
        ):
            errors.append(f"{VALIDATION}: {title}: require nonempty {', '.join(FIELDS)} in order")

    seen = set()
    for title, _ in sections(documents.get(CHANGELOG, "")):
        if title is None:
            continue
        match = RELEASE_TITLE.fullmatch(title)
        key = match[1] if match else title
        if not match and title != "Unreleased":
            errors.append(f"{CHANGELOG}: {title}: use a version or Unreleased release heading")
        elif key in seen:
            errors.append(f"{CHANGELOG}: duplicate release heading: {key}")
        seen.add(key)
        if match and f"docs/RELEASE-{key}.md" not in documents:
            errors.append(f"{CHANGELOG}: {key}: missing matching release notes")
    if not seen:
        errors.append(f"{CHANGELOG}: require a release heading")
    for name in documents:
        match = re.fullmatch(rf"docs/RELEASE-({VERSION})\.md", name)
        if match and match[1] not in seen:
            errors.append(f"{name}: add a unique release heading to {CHANGELOG}")
        if match:
            titles = [title for level, title in headings(documents[name]) if level == 1]
            if len(titles) != 1 or not titles[0].endswith(f"Scene Forge {match[1]}"):
                errors.append(f"{name}: require one matching Scene Forge version title")
    for name in (ROADMAP, RELEASING):
        for _, title in headings(documents.get(name, "")):
            if RELEASE_HISTORY.match(title):
                errors.append(f"{name}: {title}: release history belongs in the changelog")
    for name, text in documents.items():
        if name in (CHANGELOG, ROADMAP, RELEASING) or name.startswith("docs/RELEASE-"):
            if CHECKBOX.search(prose(text)):
                errors.append(f"{name}: keep validation checkboxes in {VALIDATION}")
    return errors


def validate(root: Path, documents: dict[str, str]) -> list[str]:
    errors = [f"missing required document: {name}" for name in sorted(REQUIRED - documents.keys())]
    links: dict[str, set[str]] = {}
    heading_ids = {name: anchors(text) for name, text in documents.items()}
    for name, text in documents.items():
        links[name] = set()
        for destination in destinations(text):
            try:
                resolved = local_target(root, name, destination)
            except ValueError as exc:
                errors.append(f"{name}: {destination}: {exc}")
                continue
            if resolved is None:
                continue
            target, fragment = resolved
            links[name].add(target)
            if not (root / target).exists():
                errors.append(f"{name}: missing link target: {destination}")
            elif fragment and target in heading_ids and fragment not in heading_ids[target]:
                errors.append(f"{name}: missing heading anchor: {destination}")
    for name in sorted(documents):
        if name.startswith("docs/") and name != INDEX and name not in links.get(INDEX, set()):
            errors.append(f"{name}: add a direct link from {INDEX}")
    for name in ("README.md", "AGENTS.md"):
        for target in (INDEX, POLICY):
            if target not in links.get(name, set()):
                errors.append(f"{name}: link required guide: {target}")
    errors.extend(ledger_errors(documents))
    return errors


def inventory(root: Path) -> dict[str, str]:
    """Use Git's inventory, including new nonignored files and hidden documents."""
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return {
        name: (root / name).read_text(encoding="utf-8")
        for name in sorted(set(result.stdout.decode().split("\0")) - {""})
        if (root / name).is_file()
    }


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    documents = inventory(root)
    errors = validate(root, documents)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Documentation checks passed ({len(documents)} Markdown documents).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
