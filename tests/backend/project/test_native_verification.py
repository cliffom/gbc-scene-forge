"""Exact-byte verification proofs avoid repeated raster work without weakening guards."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gbc_scene_forge.artwork import editable, layers
from gbc_scene_forge.core.errors import Conflict
from gbc_scene_forge.core.serialization import record_bytes
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.project.schema import MANIFEST
from gbc_scene_forge.project.store import ProjectStore
from gbc_scene_forge.storage.files import digest


class NativeVerificationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.project = Project.create(Path(temporary.name) / "project", "Verification")
        art = self.project.artwork.documents
        candidate = art.create("picture", "Picture", "sprite", 16, 16, self.revision())
        art.save(layers.edit(candidate, [layers.item("Base"), layers.item("Overlay")]))
        self.store = ProjectStore(self.project.root)

    def revision(self):
        return self.project.catalog()["revision"]

    def test_exact_manifest_reuses_decoding_but_checks_actual_bytes_each_time(self):
        revision = self.revision()
        with patch(
            "gbc_scene_forge.project.store.editable.decode_image", wraps=editable.decode_image
        ) as decode:
            self.store.current(revision)
            count = decode.call_count
            self.assertGreater(count, 0)
            self.store.current(revision)
            self.assertEqual(decode.call_count, count)
            document, _ = self.store.read()
            # Same length and timestamp: a stat-only cache would miss this change.
            layer = document["atlases"]["picture"]["editable"]["path"]
            path = self.project.root / layer
            original = path.read_bytes()
            stamp = path.stat()
            path.write_bytes(original.replace(b'"Base"', b'"Fake"'))
            os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
            with self.assertRaisesRegex(Conflict, "asset changed"):
                self.store.current(revision)
            path.write_bytes(original)
            self.store.current(revision)
            self.assertEqual(decode.call_count, count)

    def test_new_manifest_revalidates_and_failed_verification_never_becomes_a_proof(self):
        self.store.current(self.revision())
        document, _ = self.store.read()
        descriptor_path = document["atlases"]["picture"]["editable"]["path"]
        descriptor = json.loads((self.project.root / descriptor_path).read_bytes())
        # Valid descriptor with an inconsistent composite: file hashes alone are insufficient.
        descriptor["layers"]["items"][0]["visible"] = False
        descriptor["layers"]["items"][1]["visible"] = False
        # First put actual pixels into the saved composite so hiding every source differs.
        from gbc_scene_forge.artwork import png

        composite_path = document["atlases"]["picture"]["png"]
        composite = png.encode(16, 16, bytes([10, 20, 30, 255]) * 256)
        (self.project.root / composite_path).write_bytes(composite)
        (self.project.root / descriptor_path).write_bytes(record_bytes(descriptor))
        document["files"][composite_path] = digest(composite)
        document["files"][descriptor_path] = digest(record_bytes(descriptor))
        (self.project.root / MANIFEST).write_bytes(record_bytes(document))
        revision = self.revision()
        for _ in range(2):
            with self.assertRaises(ValueError):
                self.store.current(revision)
