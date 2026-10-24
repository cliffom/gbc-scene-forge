"""Build browser modules in staging and verify their source/output fingerprints."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "frontend-manifest.json"


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs(root):
    paths = sorted((root / "frontend").glob("*.ts")) + sorted((root / "frontend").glob("*.mts"))
    paths += [
        root / name
        for name in ("tsconfig.json", "tsconfig.build.json", "package.json", "package-lock.json")
    ]
    return {str(path.relative_to(root)): fingerprint(path) for path in paths}


def asset_names(root):
    return {
        path.stem + (".mjs" if path.suffix == ".mts" else ".js")
        for path in (root / "frontend").iterdir()
        if path.suffix in (".ts", ".mts") and not path.name.endswith(".d.ts")
    }


def current(root):
    """Validate both sides; a manifest alone cannot bless missing or stale files."""
    static = root / "src/gbc_scene_forge/static"
    try:
        manifest = json.loads((static / MANIFEST).read_text())
        names = asset_names(root)
        return (
            manifest["inputs"] == inputs(root)
            and set(manifest["outputs"]) == names
            and manifest["outputs"] == {name: fingerprint(static / name) for name in names}
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def publish(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
    try:
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def build(root=ROOT):
    compiler = root / "node_modules/typescript/bin/tsc"
    node = shutil.which("node")
    if not node or not compiler.is_file():
        raise RuntimeError(
            "Browser assets are missing or stale. Run npm ci && npm run build before "
            "building from a checkout. Release source archives include verified precompiled assets."
        )
    static = root / "src/gbc_scene_forge/static"
    source_inputs = inputs(root)
    with tempfile.TemporaryDirectory(prefix="forge-frontend-") as folder:
        staged = Path(folder)
        subprocess.run(
            [node, str(compiler), "-p", str(root / "tsconfig.build.json"), "--outDir", str(staged)],
            cwd=root,
            check=True,
        )
        if inputs(root) != source_inputs:
            raise RuntimeError("Frontend sources changed during compilation; retry the build")
        names = asset_names(root)
        manifest = {
            "inputs": source_inputs,
            "outputs": {name: fingerprint(staged / name) for name in names},
        }
        # Publish only after successful compilation; each replacement is atomic.
        static.mkdir(parents=True, exist_ok=True)
        old = set()
        try:
            old = set(json.loads((static / MANIFEST).read_text())["outputs"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        for name in sorted(names):
            publish(static / name, (staged / name).read_bytes())
        for name in old - names:
            if isinstance(name, str) and Path(name).name == name and name.endswith((".js", ".mjs")):
                (static / name).unlink(missing_ok=True)
        publish(static / MANIFEST, (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())


def ensure(root=ROOT):
    if not current(root):
        build(root)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    build(parser.parse_args().root.resolve())
