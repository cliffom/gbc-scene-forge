"""Stage a complete versioned repository marketplace; publish by atomic rename."""

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def distribution():
    spec = importlib.util.spec_from_file_location(
        "plugin_distribution", REPO / "src/gbc_scene_forge/adapters/plugin/distribution.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def package(bundle, output):
    bundle = bundle.resolve(strict=True)
    output = output.resolve()
    contract = json.loads((REPO / "plugin/compatibility.json").read_text())
    manifest = json.loads((REPO / "plugin/plugin.json").read_text())
    metadata = json.loads((bundle / "bundle.json").read_text())
    if (metadata["version"], metadata["target"]) != (
        contract["runtime_version"],
        contract["target"],
    ):
        raise ValueError("Build a matching runtime version/target before packaging")
    # Query the executable, not only its adjacent report. This runs before publication.
    identity = json.loads(subprocess.check_output([bundle / "forge", "--identity"], text=True))
    if identity["runtime_version"] != contract["runtime_version"]:
        raise ValueError("Runtime executable does not match the compatibility contract")
    output.mkdir(parents=True, exist_ok=True)
    name = f"scene-forge-{manifest['version']}-{contract['target']}"
    destination = output / name
    archive = output / (name + ".tar.gz")
    if destination.exists() or archive.exists():
        raise ValueError(
            "Versioned output exists; use a new version/output, never replace in place"
        )
    verifier = distribution()
    with tempfile.TemporaryDirectory(prefix=".scene-forge-staging-", dir=output) as temporary:
        staging = Path(temporary)
        market = staging / name
        plugin = market / "plugins/scene-forge"
        shutil.copytree(REPO / "plugin", plugin)
        (plugin / "marketplace.json").unlink()
        (plugin / "bin/forge").chmod(0o755)
        shutil.copytree(bundle, plugin / "runtime", symlinks=True)
        shutil.copy2(REPO / "LICENSE", plugin / "LICENSE")
        write(
            market / ".agents/plugins/marketplace.json",
            json.loads((REPO / "plugin/marketplace.json").read_text()),
        )
        files = verifier.inventory(plugin)
        write(
            plugin / "install.json",
            {
                "schema_version": 1,
                "plugin": manifest["name"],
                "plugin_version": manifest["version"],
                "runtime_version": metadata["version"],
                "target": metadata["target"],
                "build_id": verifier.build_id(files),
                "files": files,
            },
        )
        # A native build host may predate the advertised client OS floor. Runtime
        # entry points always use verify's host check before project access.
        verifier.verify(plugin, check_host=False)
        packed = staging / archive.name
        with tarfile.open(packed, "w:gz") as stream:
            stream.add(market, arcname=name)
        # A failed/interrupted stage cannot become an installable marketplace.
        os.rename(market, destination)
        os.rename(packed, archive)
    return destination, archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        destination, archive = package(args.bundle, args.output)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(destination)
    print(archive)


if __name__ == "__main__":
    main()
