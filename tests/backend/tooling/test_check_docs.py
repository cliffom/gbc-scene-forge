"""Regression coverage for documentation structure, inventory and link checks."""

import subprocess
import tempfile
import unittest
from pathlib import Path

from support import check_docs as docs


class DocumentationChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.documents = {name: "# Guide\n" for name in docs.REQUIRED}
        self.documents["docs/RELEASE-1.0.0.md"] = "# Scene Forge 1.0.0\n"
        self.documents[docs.CHANGELOG] = "# Changelog\n\n## 1.0.0\n\n[Notes](RELEASE-1.0.0.md)\n"
        self.documents[docs.VALIDATION] = """# Validation

## Startup (#1)

- **Scope:** Local 1.0.0 working tree, abc123; date unknown.
- **Method:** Synthetic browser fixture.
- **Result:** Startup passed; capture not archived.
- **Limits:** No physical-device inspection.

## Remaining checks

### Platforms

- [ ] Check another browser (#1).
"""
        self.index()
        for name in ("README.md", "AGENTS.md"):
            self.documents[name] += f"\n[Index]({docs.INDEX})\n[Policy]({docs.POLICY})\n"

    def index(self):
        self.documents[docs.INDEX] = "# Index\n" + "".join(
            f"\n[Guide]({name.removeprefix('docs/')})"
            for name in sorted(self.documents)
            if name.startswith("docs/") and name != docs.INDEX
        )

    def validate(self):
        for name, text in self.documents.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return docs.validate(self.root, self.documents)

    def test_valid_documents(self):
        self.assertEqual(self.validate(), [])

    def test_missing_required_document(self):
        del self.documents[docs.POLICY]
        self.assertTrue(any("missing required document" in e for e in self.validate()))

    def test_new_document_needs_direct_index_link(self):
        self.documents["docs/new/guide.md"] = "# New\n"
        self.assertTrue(any("add a direct link" in e for e in self.validate()))
        self.index()
        self.assertEqual(self.validate(), [])

    def test_root_guides_link_policy_and_index(self):
        for name in ("README.md", "AGENTS.md"):
            with self.subTest(name=name):
                original = self.documents[name]
                self.documents[name] = "# No links\n"
                self.assertEqual(sum("link required guide" in e for e in self.validate()), 2)
                self.documents[name] = original

    def test_evidence_requires_ordered_nonempty_unique_fields(self):
        original = self.documents[docs.VALIDATION]
        for replacement in (
            "",
            "- **Result:**\n",
            "- **Limits:** Partial.\n- **Result:** Passed.\n",
            "```md\n- **Result:** Passed.\n```\n",
        ):
            with self.subTest(replacement=replacement):
                self.documents[docs.VALIDATION] = original.replace(
                    "- **Result:** Startup passed; capture not archived.\n", replacement
                )
                self.assertTrue(any("in order" in e for e in self.validate()))

    def test_new_evidence_entry_cannot_borrow_previous_fields(self):
        original = self.documents[docs.VALIDATION]
        for heading in ("## Another check", "  ## Another check ##"):
            with self.subTest(heading=heading):
                self.documents[docs.VALIDATION] = original + f"\n{heading}\nEverything passed.\n"
                self.assertTrue(
                    any("Another check: require nonempty" in e for e in self.validate())
                )

    def test_subheadings_belong_to_evidence_and_fences_do_not_create_entries(self):
        self.documents[docs.VALIDATION] = self.documents[docs.VALIDATION].replace(
            "## Remaining checks", "### Capture\n\nNot archived.\n\n## Remaining checks"
        )
        self.documents[docs.VALIDATION] += "\n~~~md\n## Example\n- [ ] Example.\n~~~\n"
        self.assertEqual(self.validate(), [])

    def test_require_one_remaining_section_and_at_least_one_evidence_entry(self):
        original = self.documents[docs.VALIDATION]
        for text in (
            original.replace("## Remaining checks", "## Other checks"),
            original + "\n## Remaining checks\n- [ ] Duplicate.\n",
            "# Validation\n\n## Remaining checks\n- [ ] Pending.\n",
        ):
            with self.subTest(text=text):
                self.documents[docs.VALIDATION] = text
                self.assertTrue(self.validate())

    def test_checkboxes_cannot_escape_remaining_section(self):
        original = self.documents[docs.VALIDATION]
        for marker in ("- [ ]", "* [x]", "+ [X]", "1. [ ]", "2) [x]"):
            for prefix in ("# Validation", "- **Limits:**"):
                with self.subTest(marker=marker, prefix=prefix):
                    self.documents[docs.VALIDATION] = original.replace(
                        prefix, f"{marker} Task.\n{prefix}"
                    )
                    self.assertTrue(any("tasks belong" in e for e in self.validate()))

    def test_duplicate_or_invalid_release_headings(self):
        original = self.documents[docs.CHANGELOG]
        for title in ("1.0.0 — Duplicate", "Test diary", "Unreleased\n\n## Unreleased"):
            with self.subTest(title=title):
                self.documents[docs.CHANGELOG] = original + f"\n## {title}\n"
                self.assertTrue(any("release heading" in e for e in self.validate()))

    def test_unreleased_and_prerelease_with_metadata(self):
        self.documents["docs/RELEASE-1.1.0-rc.1+build.md"] = "# Scene Forge 1.1.0-rc.1+build\n"
        self.documents[docs.CHANGELOG] += "\n## Unreleased\n\n## 1.1.0-rc.1+build — Candidate\n"
        self.index()
        self.assertEqual(self.validate(), [])

    def test_release_inventory_matches_changelog_and_note_title(self):
        self.documents["docs/RELEASE-1.0.0.md"] = "# Scene Forge 0.9.0\n"
        self.assertTrue(any("matching Scene Forge version" in e for e in self.validate()))
        self.documents["docs/RELEASE-1.0.0.md"] = "# Scene Forge 1.0.0\n"
        self.documents[docs.CHANGELOG] = "# Changelog\n\n## 1.0.1\n"
        errors = self.validate()
        self.assertTrue(any("missing matching release notes" in e for e in errors))
        self.assertTrue(any("add a unique release heading" in e for e in errors))

    def test_planning_and_procedures_reject_release_history_in_headings(self):
        for name in (docs.ROADMAP, docs.RELEASING):
            original = self.documents[name]
            self.documents[name] += "\nCurrent baseline: v1.0.0.\n"
            self.assertEqual(self.validate(), [])
            for heading in ("## v1.0.0 — Delivered", "### Release 1.0.0", "## 1.0.0"):
                with self.subTest(name=name, heading=heading):
                    self.documents[name] = original + f"\n{heading}\n"
                    self.assertTrue(any("release history belongs" in e for e in self.validate()))
            self.documents[name] = original

    def test_validation_checklists_have_one_home(self):
        for name in (docs.ROADMAP, docs.CHANGELOG, docs.RELEASING, "docs/RELEASE-1.0.0.md"):
            with self.subTest(name=name):
                original = self.documents[name]
                self.documents[name] += "\n- [ ] Test another browser.\n"
                self.assertTrue(any("keep validation checkboxes" in e for e in self.validate()))
                self.documents[name] = original

    def test_relative_links_images_fragments_and_reference_destinations(self):
        self.documents[docs.POLICY] += "\n## Policy rules\n\n## Policy rules\n"
        self.documents[docs.ROADMAP] += (
            "\n[Policy](DOCUMENTATION.md#policy-rules-1)\n"
            "[self](#guide)\n[reference]: DOCUMENTATION.md#policy-rules\n"
            "[External](https://example.com/missing#anything)\n"
        )
        self.assertEqual(self.validate(), [])
        self.documents[docs.ROADMAP] += "\n![Missing](images/missing.png)\n[ref]: missing.md\n"
        self.assertEqual(sum("missing link target" in e for e in self.validate()), 2)
        self.documents[docs.ROADMAP] += "\n[Missing heading](DOCUMENTATION.md#absent)\n"
        self.assertTrue(any("missing heading anchor" in e for e in self.validate()))

    def test_encoded_local_paths_and_angle_brackets(self):
        self.documents["docs/space guide.md"] = "# Space guide\n"
        self.index()
        self.documents[docs.INDEX] = self.documents[docs.INDEX].replace(
            "(space guide.md)", "(<space guide.md>)"
        )
        self.documents[docs.ROADMAP] += "\n[Space](space%20guide.md#space-guide)\n"
        self.assertEqual(self.validate(), [])

    def test_local_link_cannot_escape_repository_including_symlinks(self):
        (self.root / "docs").mkdir()
        (self.root / "docs/outside").symlink_to(self.root.parent, target_is_directory=True)
        self.documents[docs.ROADMAP] += (
            "\n[Outside](../../outside.md)\n[Absolute](/etc/hosts)\n"
            "[Encoded](%2e%2e/%2e%2e/outside.md)\n[Symlink](outside/file.md)\n"
        )
        self.assertEqual(sum("relative link within" in e for e in self.validate()), 4)

    def test_fenced_and_inline_examples_are_not_links_or_headings(self):
        self.documents[docs.ROADMAP] += (
            "\n````md\n## v1.0.0\n```\n[Missing](absent.md)\n````\n"
            "~~~md\n- [ ] Example.\n[Missing](absent.md)\n~~~\n"
            "`[Missing](absent.md)`\n"
        )
        self.assertEqual(self.validate(), [])

    def test_heading_slugs_preserve_inline_code_and_unicode(self):
        self.assertEqual(
            docs.anchors("## `Save` & réouvrir (#1)\n## `Save` & réouvrir (#1)\n"),
            {"save--réouvrir-1", "save--réouvrir-1-1"},
        )

    def test_git_inventory_includes_hidden_and_untracked_but_ignores_build_outputs(self):
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / ".gitignore").write_text("build/\nnode_modules/\n")
        for name in (
            ".hidden/guide.md",
            "new.md",
            "tracked.md",
            "build/log.md",
            "node_modules/README.md",
        ):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# Guide\n")
        subprocess.run(["git", "add", "tracked.md"], cwd=self.root, check=True)
        self.assertEqual(
            set(docs.inventory(self.root)), {".hidden/guide.md", "new.md", "tracked.md"}
        )
        (self.root / "tracked.md").unlink()
        self.assertNotIn("tracked.md", docs.inventory(self.root))


if __name__ == "__main__":
    unittest.main()
