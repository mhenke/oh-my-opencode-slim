import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from cartographer import (PatternMatcher, compute_file_hash,
                          compute_folder_hash, load_state, select_files)


class TestCartographer(unittest.TestCase):
    def test_pattern_matcher(self):
        patterns = ["node_modules/", "dist/", "*.log", "src/**/*.ts"]
        matcher = PatternMatcher(patterns)

        self.assertTrue(matcher.matches("node_modules/foo.js"))
        self.assertTrue(matcher.matches("vendor/node_modules/bar.js"))
        self.assertTrue(matcher.matches("dist/main.js"))
        self.assertTrue(matcher.matches("src/dist/output.js"))

        self.assertTrue(matcher.matches("error.log"))
        self.assertTrue(matcher.matches("logs/access.log"))

        self.assertTrue(matcher.matches("src/index.ts"))
        self.assertTrue(matcher.matches("src/utils/helper.ts"))

        self.assertFalse(matcher.matches("README.md"))
        self.assertFalse(matcher.matches("tests/test.py"))

    def test_compute_file_hash(self):
        with tempfile.NamedTemporaryFile(mode="wb", delete=False) as f:
            f.write(b"test content")
            f_path = f.name

        try:
            h1 = compute_file_hash(Path(f_path))
            expected = hashlib.md5(b"test content").hexdigest()
            self.assertEqual(h1, expected)
            self.assertEqual(h1, "9473fdd0d880a43c21b7778d34872157")
        finally:
            if os.path.exists(f_path):
                os.unlink(f_path)

    def test_compute_folder_hash(self):
        file_hashes = {
            "src/a.ts": "hash-a",
            "src/b.ts": "hash-b",
            "tests/test.ts": "hash-test"
        }

        h1 = compute_folder_hash("src", file_hashes)
        h2 = compute_folder_hash("src", file_hashes)
        self.assertEqual(h1, h2)

        file_hashes_alt = {
            "src/a.ts": "hash-a-modified",
            "src/b.ts": "hash-b"
        }
        h3 = compute_folder_hash("src", file_hashes_alt)
        self.assertNotEqual(h1, h3)

    def test_select_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "src").mkdir()
            (root / "node_modules").mkdir()
            (root / "src" / "index.ts").write_text("code")
            (root / "src" / "index.test.ts").write_text("test")
            (root / "node_modules" / "foo.js").write_text("dep")
            (root / "package.json").write_text("{}")

            includes = ["src/**/*.ts", "package.json"]
            excludes = ["**/*.test.ts", "node_modules/"]
            exceptions = []

            selected = select_files(root, includes, excludes, exceptions, [])

            rel_selected = sorted([os.path.relpath(f, root) for f in selected])
            self.assertEqual(rel_selected, ["package.json", "src/index.ts"])

    def test_load_state_migrates_legacy_cartography_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            slim_dir = root / ".slim"
            slim_dir.mkdir()

            legacy_path = slim_dir / "cartography.json"
            legacy_state = {"metadata": {"version": "1.0.0"}}
            legacy_path.write_text(json.dumps(legacy_state), encoding="utf-8")

            loaded = load_state(root)

            self.assertEqual(loaded, legacy_state)
            self.assertFalse(legacy_path.exists())
            self.assertTrue((slim_dir / "codemap.json").exists())


if __name__ == "__main__":
    unittest.main()
