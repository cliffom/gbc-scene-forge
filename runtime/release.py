"""Prepare immutable macOS candidates and evidence; never publish or assert client acceptance."""

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from package_plugin import distribution, package

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def observe(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    return {
        "command": list(map(str, command)),
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def native_files(root):
    # Inspect contents, including extensionless CPython and PyInstaller binaries.
    magics = {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
    result = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            with path.open("rb") as stream:
                if stream.read(4) in magics:
                    result.append(path)
    return result


def extract(archive, expected_sha256, destination):
    if digest(archive) != expected_sha256:
        raise ValueError("Archive SHA-256 mismatch before extraction")
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive) as stream:
        stream.extractall(destination, filter="data")
    roots = list(destination.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise ValueError("Expected exactly one repository directory")
    return roots[0]


def check_archive(archive, expected_sha256, output, python, codex=None):
    repository = extract(archive, expected_sha256, output / "original extraction")
    moved = output / "relocated repository café"
    repository.rename(moved)
    plugin = moved / "plugins/scene-forge"
    installed = distribution().verify(plugin, check_host=False)
    contract = json.loads((plugin / "compatibility.json").read_text())
    qualified = (platform.system(), platform.machine()) == ("Darwin", "arm64") and (
        tuple(map(int, platform.mac_ver()[0].split(".")[:2]))
        >= tuple(map(int, contract["minimum_macos"].split(".")))
    )
    before = distribution().inventory(plugin)
    modes = {p: p.stat().st_mode & 0o777 for p in [moved, *moved.rglob("*")] if not p.is_symlink()}
    evidence = {
        "installation": installed,
        "host": platform.platform(),
        "archive_sha256": expected_sha256,
        "client_os_floor_met": qualified,
        "native_client": "not run",
        "normal_user_download_acceptance": "not run",
    }
    try:
        for path, mode in modes.items():
            path.chmod(mode & ~0o222)
        executable = plugin / "runtime/forge"
        signatures = []
        build = json.loads((plugin / "runtime/bundle.json").read_text())
        signature_details = {}
        for binary in native_files(plugin / "runtime"):
            record = observe(["/usr/bin/codesign", "--verify", "--strict", str(binary)])
            if record["exit_code"]:
                raise ValueError(f"Invalid native signature: {binary}: {record['stderr']}")
            name = str(binary.relative_to(plugin))
            signatures.append(name)
            if build.get("signing") == "developer-id":
                details = observe(["/usr/bin/codesign", "-dvvv", str(binary)])
                if (
                    details["exit_code"]
                    or "Authority=Developer ID Application:" not in details["stderr"]
                    or "(runtime)" not in details["stderr"]
                    or "Timestamp=" not in details["stderr"]
                ):
                    raise ValueError(f"Missing Developer ID/hardened runtime/timestamp: {binary}")
                signature_details[name] = details
        if not signatures:
            raise ValueError("No signed Mach-O files found")
        evidence["verified_native_files"] = signatures
        evidence["developer_id_signatures"] = signature_details
        evidence["codesign"] = observe(["/usr/bin/codesign", "-dvvv", str(executable)])
        # Gatekeeper rejection is evidence, not silently upgraded to a trusted install.
        evidence["gatekeeper"] = observe(
            ["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", str(executable)]
        )
        if qualified:
            env = {
                **os.environ,
                "PATH": "/unavailable",
                "PYTHONHOME": "/unavailable",
                "PYTHONPATH": "/unavailable",
            }
            result = subprocess.run(
                [plugin / "bin/forge", "--identity"],
                env=env,
                cwd=plugin,
                capture_output=True,
                text=True,
                timeout=30,
                check=True,
            )
            if json.loads(result.stdout)["installation"] != installed or result.stderr:
                raise ValueError("Installed launcher identity mismatch")
            evidence["readonly_launcher"] = "passed; empty runtime PATH"
        else:
            evidence["readonly_launcher"] = "not run; host below advertised client OS floor"
        # SDK smoke copies only the runtime to a separate read-only location; it
        # does not claim that a below-floor host supports the installed plugin.
        subprocess.run(
            [
                python,
                REPO / "tests/packaging/bundle_smoke.py",
                "--bundle",
                executable.parent,
                "--output",
                output / "sdk-smoke",
            ],
            check=True,
        )
        evidence["official_sdk"] = json.loads((output / "sdk-smoke/report.json").read_text())
        if qualified:
            subprocess.run(
                [
                    python,
                    REPO / "tests/packaging/plugin_lifecycle_smoke.py",
                    "--runtime",
                    executable,
                    "--output",
                    output / "lifecycle",
                ],
                check=True,
            )
            evidence["lifecycle"] = json.loads((output / "lifecycle/result.json").read_text())
        if codex and qualified:
            subprocess.run(
                [
                    python,
                    REPO / "tests/packaging/plugin_distribution_smoke.py",
                    "--archive",
                    archive,
                    "--codex",
                    codex,
                    "--output",
                    output / "native-client",
                ],
                check=True,
            )
            evidence["native_client"] = "synthetic install/update/disable/rollback/uninstall passed"
            evidence["codex_version"] = subprocess.check_output(
                [codex, "--version"], text=True
            ).strip()
        if before != distribution().inventory(plugin):
            raise ValueError("Restricted installation changed during acceptance")
        evidence["readonly_unchanged"] = True
    finally:
        for path, mode in modes.items():
            path.chmod(mode)
        write(output / "archive-check.json", evidence)
    return evidence


def prepare(args):
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        raise ValueError("Supply the full source Git revision")
    actual_revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
    ).strip()
    if actual_revision != args.revision:
        raise ValueError("Source revision differs from this checkout")
    source_diff = subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=REPO)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    _, archive = package(args.bundle, output)
    evidence = check_archive(
        archive, digest(archive), output, str(args.python.absolute()), args.codex
    )
    plugin = output / "relocated repository café/plugins/scene-forge"
    bundle = json.loads((plugin / "runtime/bundle.json").read_text())
    # Preserve the inventory and license provenance separately for release review.
    inventory = json.loads((plugin / "runtime/notices/python-packages/inventory.json").read_text())
    write(
        output / "dependency-inventory.json",
        {
            "python_packages": inventory,
            "python": bundle["config"],
            "system_libraries": bundle["os_libraries"],
            "native_licenses": "plugins/scene-forge/runtime/notices/python-native/",
            "frontend_notices": "plugins/scene-forge/runtime/notices/frontend.txt",
            "scope": "build environment superset; complete license files are in the archive",
        },
    )
    write(
        output / "release.json",
        {
            "schema_version": 1,
            "source_revision": args.revision,
            "tracked_source_dirty": bool(source_diff),
            "tracked_source_diff_sha256": hashlib.sha256(source_diff).hexdigest(),
            "release_tool_inputs": {
                path.name: digest(path)
                for path in (HERE / "release.py", HERE / "package_plugin.py")
            },
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "installation": evidence["installation"],
            "runtime": bundle,
            "archive": archive.name,
            "archive_sha256": digest(archive),
            "status": "candidate; not published or certified for normal-user installation",
            "signing": bundle.get("signing", "unknown"),
            "notarization": "not established by this build",
            "installed_client_acceptance": evidence["native_client"],
        },
    )
    deliverables = [
        archive,
        output / "release.json",
        output / "dependency-inventory.json",
        output / "archive-check.json",
    ]
    (output / "SHA256SUMS").write_text("".join(f"{digest(p)}  {p.name}\n" for p in deliverables))
    print(output / "SHA256SUMS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bundle", type=Path)
    source.add_argument("--archive", type=Path, help="Verify an existing candidate archive")
    parser.add_argument("--sha256", help="Expected archive digest, obtained from a trusted source")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--revision", help="Full source revision; required for candidate preparation"
    )
    parser.add_argument(
        "--python",
        type=Path,
        default=Path(sys.executable),
        help="Test interpreter with official MCP SDK; never used by runtime",
    )
    parser.add_argument("--codex", help="Absolute native Codex path; isolated synthetic acceptance")
    args = parser.parse_args()
    if args.archive:
        if not args.sha256:
            parser.error("--archive requires --sha256")
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=False)
        check_archive(
            args.archive.resolve(), args.sha256, output, str(args.python.absolute()), args.codex
        )
    else:
        if not args.revision:
            parser.error("--bundle requires --revision")
        prepare(args)


if __name__ == "__main__":
    main()
