"""Settings, paths and logging. Values come from environment variables and `.env` files."""
from __future__ import annotations

import logging
import logging.handlers
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]


def _data_dir() -> Path:
    # Electron passes its userData folder; standalone runs use ./backend/.data
    d = Path(os.environ.get("CLIPFORGE_DATA_DIR") or REPO_ROOT / "backend" / ".data")
    d.mkdir(parents=True, exist_ok=True)
    return d


DATA_DIR = _data_dir()

# .env in the data folder wins over the repo one (useful once the app is packaged).
load_dotenv(REPO_ROOT / ".env")
load_dotenv(DATA_DIR / ".env", override=True)


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None = os.environ.get("ANTHROPIC_API_KEY") or None
    claude_model: str = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
    # Empty = pick automatically from the device (GPU: medium, CPU: small).
    whisper_model: str = os.environ.get("WHISPER_MODEL", "")
    # "auto" | "cuda" | "cpu"
    whisper_device: str = os.environ.get("WHISPER_DEVICE", "auto")
    cache_dir: Path = DATA_DIR / "cache"
    log_dir: Path = DATA_DIR / "logs"


settings = Settings()


def setup_logging() -> None:
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    file = logging.handlers.RotatingFileHandler(
        settings.log_dir / "backend.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    file.setFormatter(fmt)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers = [file, console]
