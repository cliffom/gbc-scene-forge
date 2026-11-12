"""Build a native PyInstaller folder from a production wheel and pinned Python archive."""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import time
import zipfile
from email.parser import Parser
from pathlib import Path

from provenance import checkout

HERE = Path(__file__).resolve().parent


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(*command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, **kwargs)


def wheel_version(wheel):
    with zipfile.ZipFile(wheel) as archive:
        metadata = json.loads(archive.read("gbc_scene_forge/static/build-info.json"))
        record = next(name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
        version = Parser().parsestr(archive.read(record).decode())["Version"]
        if metadata["version"] != version:
            raise ValueError("Build the wheel with FORGE_BUILD_MODE=production")
        return metadata["version"]


def os_libraries(bundle):
    binaries = [bundle / "forge", *bundle.rglob("*.so"), *bundle.rglob("*.dylib")]
    dependencies = subprocess.check_output(["otool", "-L", *map(str, binaries)], text=True)
    external = set()
    for line in dependencies.splitlines():
        if not line.startswith("\t"):
            continue
        library = line.strip().split(" (", 1)[0]
        if library.startswith("/"):
            if not library.startswith(("/usr/lib/", "/System/Library/")):
                raise ValueError(f"Bundle depends on a non-system library: {library}")
            external.add(library)
    return sorted(external)


def build(args):
    build_checkout = checkout(HERE.parent)
    config = json.loads((HERE / "config.json").read_text())
    if (platform.system(), platform.machine()) != (config["system"], config["machine"]):
        raise ValueError(f"Build natively on {config['target']}; other targets belong to #263")
    uv = str(Path(shutil.which(str(args.uv)) or args.uv).resolve(strict=True))
    if subprocess.check_output([uv, "--version"], text=True).split()[1] != config["uv_version"]:
        raise ValueError(f"Use uv {config['uv_version']}")
    wheel = args.wheel.resolve(strict=True)
    version = wheel_version(wheel)
    archive = args.python_archive.resolve(strict=True)
    if digest(archive) != config["python_sha256"]:
        raise ValueError("Python archive SHA-256 does not match runtime/config.json")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    # The digest above authenticates this archive before extraction. bsdtar supplies zstd support.
    python_source = output / "python-source"
    python_source.mkdir()
    run("tar", "-xf", archive, "-C", python_source)
    prefix = python_source / "python/install"
    python = prefix / "bin/python3.13"
    if subprocess.check_output([python, "--version"], text=True).strip() != (
        "Python " + config["python_version"]
    ):
        raise ValueError("Unexpected bundled Python version")
    env = output / "build-env"
    run(uv, "venv", "--python", python, env)
    interpreter = env / "bin/python"
    run(
        uv,
        "pip",
        "install",
        "--python",
        interpreter,
        "--only-binary=:all:",
        "--require-hashes",
        "-r",
        HERE / "runtime-requirements.txt",
        "-r",
        HERE / "build-requirements.txt",
    )
    run(uv, "pip", "install", "--python", interpreter, "--no-deps", wheel)
    name = f"forge-{version}-{config['target']}"
    signing = []
    if args.codesign_identity:
        signing = ["--codesign-identity", args.codesign_identity]
    run(
        interpreter,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "forge",
        "--distpath",
        output / "frozen",
        "--workpath",
        output / "work",
        "--specpath",
        output,
        "--collect-all",
        "gbc_scene_forge",
        "--copy-metadata",
        "mcp",
        "--collect-all",
        "pydantic",
        *signing,
        HERE / "entry.py",
        env={**os.environ, "PYTHONHASHSEED": "0"},
    )
    bundle = output / name
    shutil.move(output / "frozen/forge", bundle)
    notices = bundle / "notices"
    run(interpreter, HERE / "notices.py", notices / "python-packages")
    shutil.copytree(python_source / "python/licenses", notices / "python-native")
    shutil.copy2(prefix / "lib/python3.13/LICENSE.txt", notices / "PYTHON-LICENSE.txt")
    shutil.copy2(
        bundle / "_internal/gbc_scene_forge/static/third-party-notices.txt",
        notices / "frontend.txt",
    )
    report = {
        "schema_version": 1,
        "version": version,
        "target": config["target"],
        "host": platform.platform(),
        "os_libraries": os_libraries(bundle),
        "config": config,
        "wheel_sha256": digest(wheel),
        "build_checkout": build_checkout,
        # The wheel is a prebuilt input, possibly from another checkout/revision.
        "wheel_source_revision": None,
        "signing": "developer-id" if args.codesign_identity else "ad-hoc",
        "inputs": {path.name: digest(path) for path in sorted(HERE.iterdir()) if path.is_file()},
        "build_seconds": round(time.monotonic() - started, 3),
    }
    (bundle / "bundle.json").write_text(json.dumps(report, indent=2) + "\n")
    report["installed_file_bytes"] = sum(p.stat().st_size for p in bundle.rglob("*") if p.is_file())
    # A size comparison only; signed/versioned release archives are owned by #258/#263.
    with tempfile.TemporaryFile() as sample:
        with tarfile.open(fileobj=sample, mode="w:gz") as compressed:
            compressed.add(bundle, arcname=name)
        report["gzip_sample_bytes"] = sample.tell()
    (output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(bundle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--python-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New build directory")
    parser.add_argument("--uv", default="uv")
    parser.add_argument("--codesign-identity", help="Developer ID identity in the build keychain")
    try:
        build(parser.parse_args())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
