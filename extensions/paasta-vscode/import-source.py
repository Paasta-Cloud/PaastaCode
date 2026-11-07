"""Extract an uploaded project snapshot into an empty workspace, without ZIP traversal."""
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_BYTES = 50 * 1024 * 1024


def extract(archive, destination):
    target = Path(destination).resolve(strict=True)
    if not target.is_dir() or any(target.iterdir()):
        raise ValueError("Workspace must be an empty directory")
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) > 5000 or sum(info.file_size for info in entries) > MAX_BYTES:
            raise ValueError("Archive exceeds 5000 entries or 50 MiB")
        seen = set()
        files = []
        for info in entries:
            name = info.filename
            parts = PurePosixPath(name).parts
            mode = info.external_attr >> 16
            if not name or name.startswith(("/", "\\")) or "\\" in name or any(ord(c) < 32 for c in name) or ":" in name or any(p.lower() in {".", "..", ".git"} or p.endswith((".", " ")) or p.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL"} for p in parts):
                raise ValueError("Unsafe archive path")
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError("Links and special files are forbidden")
            normalized = "/".join(parts).casefold()
            if normalized in seen:
                raise ValueError("Duplicate archive path")
            seen.add(normalized)
            if not info.is_dir():
                files.append(info)
        # Fully validate/decompress in a sibling staging directory before touching the workspace.
        with tempfile.TemporaryDirectory(prefix="paasta-import-", dir=target.parent) as staging:
            stage = Path(staging)
            for info in files:
                output = stage.joinpath(*PurePosixPath(info.filename).parts)
                output.parent.mkdir(parents=True, exist_ok=True)
                with source.open(info) as incoming, output.open("xb") as outgoing:
                    remaining = info.file_size
                    while True:
                        block = incoming.read(min(65536, remaining + 1))
                        if not block:
                            break
                        remaining -= len(block)
                        if remaining < 0:
                            raise ValueError("Archive size mismatch")
                        outgoing.write(block)
                    if remaining:
                        raise ValueError("Archive size mismatch")
            if any(target.iterdir()):
                raise ValueError("Workspace changed during import")
            # Never overwrite. If another writer appears, leave its data untouched.
            try:
                for item in sorted(stage.rglob("*")):
                    output = target / item.relative_to(stage)
                    if item.is_dir():
                        output.mkdir()
                    else:
                        # Atomic creation: unlike rename(), link() never replaces an existing file.
                        os.link(item, output)
            except Exception:
                # Do not delete partially imported/user-edited files on failure.
                raise ValueError("Import interrupted; inspect existing files before retrying") from None


if __name__ == "__main__":
    try:
        extract(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
