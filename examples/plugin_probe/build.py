"""Build two disposable macOS arm64 local marketplaces for issue #254."""

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PLUGIN = "forge-authoring-probe"


def run(*command):
    subprocess.run([str(value) for value in command], check=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def build(args):
    if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
        raise ValueError("Build this feasibility comparison natively on macOS arm64")
    wheel = args.wheel.resolve(strict=True)
    python = args.python.resolve(strict=True)
    settings = args.settings.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    # Build inputs are explicit: the same wheel, runtime and locked dependency set for both modes.
    env = output / "build-env"
    run(args.uv, "venv", "--python", python, env)
    interpreter = env / "bin/python"
    run(
        args.uv,
        "pip",
        "install",
        "--python",
        interpreter,
        "--require-hashes",
        "-r",
        HERE / "runtime-requirements.txt",
        "-r",
        HERE / "build-requirements.txt",
    )
    run(args.uv, "pip", "install", "--python", interpreter, "--no-deps", wheel)
    report = {
        "platform": platform.platform(),
        "python": str(python),
        "python_version": subprocess.check_output([str(python), "--version"], text=True).strip(),
        "uv_version": subprocess.check_output([str(args.uv), "--version"], text=True).strip(),
        "source_base": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
        ).strip(),
        "probe_source_sha256": {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (
                HERE / "build.py",
                HERE / "entry.py",
                HERE / "skill.txt",
                HERE / "runtime-requirements.txt",
                HERE / "build-requirements.txt",
            )
        },
        "wheel_sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
        "bundles": {},
    }
    for mode in ("private-python", "pyinstaller"):
        started = time.monotonic()
        marketplace = output / mode
        plugin = marketplace / "plugins" / PLUGIN
        plugin.mkdir(parents=True)
        runtime = plugin / "runtime"
        if mode == "private-python":
            # Input must be an unpacked python-build-standalone install, not a venv/system Python.
            prefix = Path(
                subprocess.check_output(
                    [str(python), "-I", "-c", "import sys; print(sys.prefix)"], text=True
                ).strip()
            )
            if not (prefix / "lib/libpython3.13.dylib").is_file():
                raise ValueError("Use the documented standalone CPython 3.13 install")
            shutil.copytree(prefix, runtime / "python", symlinks=True)
            run(
                args.uv,
                "pip",
                "install",
                "--python",
                interpreter,
                "--target",
                runtime / "site-packages",
                "--require-hashes",
                "-r",
                HERE / "runtime-requirements.txt",
            )
            run(
                args.uv,
                "pip",
                "install",
                "--python",
                interpreter,
                "--target",
                runtime / "site-packages",
                "--no-deps",
                wheel,
            )
            shutil.copy2(HERE / "entry.py", runtime / "entry.py")
            command = (
                'exec "$root/runtime/python/bin/python3.13" -I -B "$root/runtime/entry.py" "$@"'
            )
        else:
            run(
                interpreter,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--onedir",
                "--name",
                "forge",
                "--distpath",
                output / "frozen-dist",
                "--workpath",
                output / "frozen-work",
                "--specpath",
                output,
                "--collect-all",
                "gbc_scene_forge",
                "--copy-metadata",
                "mcp",
                "--collect-all",
                "pydantic",
                HERE / "entry.py",
            )
            shutil.copytree(output / "frozen-dist/forge", runtime, symlinks=True)
            command = 'exec "$root/runtime/forge" "$@"'
        launcher = plugin / "bin/forge"
        launcher.parent.mkdir()
        launcher.write_text(
            '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "${0%/*}/.." && pwd)\n' + command + "\n"
        )
        launcher.chmod(0o755)
        write_json(
            plugin / "plugin.json",
            {
                "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
                "name": PLUGIN,
                "version": "0.0.0-probe.254",
                "description": "Experimental local Forge packaging and inspected-authoring probe",
                "license": "MIT",
                "extensions": {
                    "com.openai": {
                        "requires_local_executor": True,
                        "interface": {"displayName": "Forge authoring feasibility probe"},
                    }
                },
            },
        )
        write_json(
            plugin / "mcp.json",
            {
                "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
                "mcpServers": {
                    "forge": {
                        "type": "stdio",
                        "command": "./bin/forge",
                        "cwd": "${PLUGIN_ROOT}",
                        "args": ["mcp"],
                        "env": {"FORGE_PLUGIN_PROBE_SETTINGS": str(settings)},
                    }
                },
            },
        )
        skill = plugin / "skills/forge-probe/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text((HERE / "skill.txt").read_text())
        shutil.copy2(REPO / "LICENSE", plugin / "LICENSE")
        write_json(
            marketplace / ".agents/plugins/marketplace.json",
            {
                "name": f"forge-probe-{mode}",
                "interface": {"displayName": f"Forge probe ({mode})"},
                "plugins": [
                    {
                        "name": PLUGIN,
                        "source": {"source": "local", "path": f"./plugins/{PLUGIN}"},
                        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                        "category": "Productivity",
                    }
                ],
            },
        )
        archive = output / f"{mode}.tar.gz"
        with tarfile.open(archive, "w:gz") as packed:
            packed.add(marketplace, arcname=mode)
        report["bundles"][mode] = {
            "build_seconds": round(time.monotonic() - started, 3),
            "files_bytes": sum(p.stat().st_size for p in plugin.rglob("*") if p.is_file()),
            "archive_bytes": archive.stat().st_size,
            "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        }
    write_json(output / "build-report.json", report)
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--settings", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New disposable directory")
    parser.add_argument("--uv", default="uv")
    build(parser.parse_args())


if __name__ == "__main__":
    main()
