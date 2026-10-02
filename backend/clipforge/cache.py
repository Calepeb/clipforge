"""Per-media-file JSON cache, keyed by path + size + mtime so edits to a file invalidate it."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from .config import settings

log = logging.getLogger(__name__)


def cache_file(kind: str, media: Path, extra: str = "") -> Path:
    st = media.stat()
    key = f"{media.resolve()}|{st.st_size}|{st.st_mtime_ns}|{extra}"
    d = settings.cache_dir / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{hashlib.sha1(key.encode()).hexdigest()}.json"


def load(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:  # noqa: BLE001 - a corrupt cache entry is just recomputed
        log.exception("Ignoring unreadable cache file %s", path)
        return None


def save(path: Path, data: Any) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), "utf-8")
    tmp.replace(path)
