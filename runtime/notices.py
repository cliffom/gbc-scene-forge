"""Collect installed distribution license files with their provenance at build time."""

import json
import shutil
import sys
from importlib.metadata import distributions
from pathlib import Path


def collect(destination):
    destination.mkdir(parents=True, exist_ok=False)
    inventory = []
    for package in sorted(distributions(), key=lambda item: item.metadata["Name"].lower()):
        licenses = []
        for member in package.files or []:
            name = member.name.lower()
            if name.startswith(("license", "copying", "notice", "authors")):
                source = Path(package.locate_file(member))
                target = destination / package.metadata["Name"] / str(member)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                licenses.append(str(target.relative_to(destination)))
        if not licenses:
            raise ValueError(f"No license files found for {package.metadata['Name']}")
        inventory.append(
            {"name": package.metadata["Name"], "version": package.version, "licenses": licenses}
        )
    (destination / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")


if __name__ == "__main__":
    collect(Path(sys.argv[1]))
