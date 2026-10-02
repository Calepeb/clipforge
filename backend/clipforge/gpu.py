"""GPU acceleration for transcription in the installed app.

The installer can't carry NVIDIA's CUDA libraries (~2 GB; NSIS installers max out at
2 GB), so "Enable GPU acceleration" downloads the same pip wheels `npm run setup:backend`
installs — nvidia-cublas-cu12, nvidia-cudnn-cu12 and nvidia-cuda-nvrtc-cu12 from PyPI —
and extracts just their DLLs into <data dir>/cuda.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

from .config import DATA_DIR

log = logging.getLogger(__name__)

CUDA_DIR = DATA_DIR / "cuda"
# Same packages/versions as backend/requirements-gpu.txt resolved to in development.
PACKAGES = [("nvidia-cublas-cu12", "12.9.2.10"), ("nvidia-cudnn-cu12", "9.27.0.42"), ("nvidia-cuda-nvrtc-cu12", "12.9.86")]
REQUIRED = ("cublas64_12", "cudnn_ops64_9")


class GpuInstallError(Exception):
    pass


def nvidia_gpu() -> str | None:
    """Name of the NVIDIA GPU, if the driver reports one."""
    try:
        out = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return None
    line = out.stdout.strip().splitlines()[0] if out.returncode == 0 and out.stdout.strip() else ""
    return line.split(":", 1)[1].split("(UUID")[0].strip() if ":" in line else None


def dll_dirs() -> list[Path]:
    """Directories that may hold CUDA DLLs: pip packages (dev) and the downloaded copy."""
    import site

    dirs = [CUDA_DIR]
    bases = list(site.getsitepackages()) if hasattr(site, "getsitepackages") else []
    if getattr(sys, "frozen", False):
        bases.append(getattr(sys, "_MEIPASS", ""))
    for base in bases:
        for lib in ("cublas", "cudnn", "cuda_nvrtc"):
            dirs.append(Path(base) / "nvidia" / lib / "bin")
    return [d for d in dirs if d.is_dir()]


def libs_present() -> bool:
    names = {p.name.lower() for d in dll_dirs() for p in d.glob("*.dll")}
    return all(any(n.startswith(r) for n in names) for r in REQUIRED)


def _wheel_url(name: str, version: str) -> tuple[str, int]:
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json", timeout=30) as r:
        info = json.load(r)
    for f in info["urls"]:
        if f["packagetype"] == "bdist_wheel" and "win_amd64" in f["filename"]:
            return f["url"], f["size"]
    raise GpuInstallError(f"No Windows build of {name} {version} on PyPI.")


def install(on_progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    if sys.platform != "win32":
        raise GpuInstallError("GPU download is only needed on Windows; on Linux use `npm run setup:backend`.")
    if not nvidia_gpu():
        raise GpuInstallError("No NVIDIA GPU was found, so GPU acceleration can't be used on this computer.")
    CUDA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        wheels = [(name, *_wheel_url(name, version)) for name, version in PACKAGES]
    except OSError as e:
        raise GpuInstallError(f"Couldn't reach PyPI to download the GPU libraries ({e}).") from e
    total = sum(size for _, _, size in wheels)
    done = 0
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as tmp:
        for name, url, size in wheels:
            target = Path(tmp) / url.rsplit("/", 1)[1]
            log.info("Downloading %s (%.0f MB)", name, size / 1e6)
            with urllib.request.urlopen(url, timeout=60) as r, target.open("wb") as f:
                while chunk := r.read(1 << 20):
                    if cancelled():
                        raise InterruptedError()
                    f.write(chunk)
                    done += len(chunk)
                    on_progress(0.95 * done / total, f"Downloading {name} ({done / 1e9:.1f} / {total / 1e9:.1f} GB)")
            with zipfile.ZipFile(target) as z:
                for member in z.namelist():
                    if member.lower().endswith(".dll") and "/bin/" in member:
                        with z.open(member) as src, (CUDA_DIR / Path(member).name).open("wb") as dst:
                            shutil.copyfileobj(src, dst)
            target.unlink()
    on_progress(1.0, "Installed")
    if not libs_present():
        raise GpuInstallError("The download finished but the CUDA libraries are incomplete. Try again.")
    return {"path": str(CUDA_DIR)}
