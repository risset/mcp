"""Validate the complete untrusted artifact before writing regular site files."""

import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

MAX_FILES = 20_000
MAX_BYTES = 512 * 1024 * 1024


def unpack(archive, destination):
    destination = Path(destination)
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) > MAX_FILES or sum(item.file_size for item in entries) > MAX_BYTES:
            raise ValueError("Docs artifact exceeds extraction limits")
        seen = set()
        for item in entries:
            name = item.filename
            parts = PurePosixPath(name).parts
            kind = stat.S_IFMT(item.external_attr >> 16)
            if (name != item.orig_filename or not parts or name.startswith("/")
                    or "\\" in name or ":" in name
                    or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                    or item.flag_bits & 1
                    or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or (kind == stat.S_IFDIR and not item.is_dir())
                    or name.rstrip("/") in seen):
                raise ValueError(f"Unsafe artifact entry: {name!r}")
            seen.add(name.rstrip("/"))
        if "index.html" not in seen or bundle.getinfo("index.html").is_dir():
            raise ValueError("Docs artifact has no root index.html")
        # Reject file/directory collisions before creating anything.
        files = {item.filename for item in entries if not item.is_dir()}
        if any(str(parent) in files for item in entries
               for parent in PurePosixPath(item.filename).parents if str(parent) != "."):
            raise ValueError("Artifact contains conflicting paths")
        destination.mkdir(parents=True, exist_ok=False)
        for item in entries:
            target = destination / item.filename
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
        # Build metadata is not part of the public preview.
        for name in (".git", ".github", ".meta", ".etc"):
            target = destination / name
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
        (destination / "deployid").unlink(missing_ok=True)


if __name__ == "__main__":
    unpack(*sys.argv[1:])
