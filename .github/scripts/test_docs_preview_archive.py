import io
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from docs_preview_archive import unpack


class ArchiveTests(unittest.TestCase):
    def archive(self, entries):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("index.html", "<html>Docs</html>")
            for name, content in entries:
                bundle.writestr(name, content)
        archive.seek(0)
        return archive

    def test_extracts_site_and_removes_build_metadata(self):
        archive = self.archive([
            ("mcp/2/index.html", "Docs"),
            ("assets/site.css", "body {}"),
            (".meta/pageList.json", "{}"),
            (".etc/redirects", "{}"),
            ("deployid", "999"),
        ])
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "site"
            unpack(archive, destination)
            self.assertEqual((destination / "mcp/2/index.html").read_text(), "Docs")
            self.assertTrue((destination / "assets/site.css").is_file())
            self.assertFalse((destination / "deployid").exists())
            self.assertFalse((destination / ".meta").exists())
            self.assertFalse((destination / ".etc").exists())

    def test_rejects_unsafe_paths_before_writing(self):
        for name in ["../escape", "/absolute", "a/../../escape",
                     "a/./file", "a//file", "a\\escape", "C:/escape"]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "site"
                with self.assertRaises(ValueError):
                    unpack(self.archive([(name, "bad")]), destination)
                self.assertFalse(destination.exists())

    def test_rejects_symlinks_and_special_files(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK):
            info = zipfile.ZipInfo("unsafe")
            info.create_system = 3
            info.external_attr = (kind | 0o777) << 16
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    unpack(self.archive([(info, "/etc/passwd")]), Path(directory) / "site")

    def test_rejects_file_directory_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "site"
            with self.assertRaises(ValueError):
                unpack(self.archive([("assets", "file"), ("assets/site.css", "css")]),
                       destination)
            self.assertFalse(destination.exists())

    def test_rejects_missing_index(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("other.html", "Docs")
        archive.seek(0)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                unpack(archive, Path(directory) / "site")

    def test_enforces_size_and_file_limits(self):
        for setting, limit in [("MAX_FILES", 1), ("MAX_BYTES", 1)]:
            with self.subTest(setting=setting), tempfile.TemporaryDirectory() as directory:
                with patch("docs_preview_archive." + setting, limit):
                    with self.assertRaises(ValueError):
                        unpack(self.archive([("extra.html", "Docs")]),
                               Path(directory) / "site")


if __name__ == "__main__":
    unittest.main()
