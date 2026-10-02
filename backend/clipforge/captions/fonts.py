"""Caption fonts for libass, built from the same files the editor preview uses (public/fonts).

libass can't pick weights out of variable fonts, so variable fonts are pinned into static
instances (one file per weight) in the cache. We also record each family's size factor:
libass sizes text by the font's winAscent+winDescent, while CSS sizes by the em square,
so an ASS font size must be css_px * (winAscent + winDescent) / unitsPerEm to match.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

from ..config import DATA_DIR, REPO_ROOT, settings

log = logging.getLogger(__name__)

# Installed app: Electron passes the bundled fonts folder. Development: public/fonts.
SOURCE_DIR = Path(os.environ.get("CLIPFORGE_FONTS_DIR") or REPO_ROOT / "public" / "fonts")
BRAND_DIR = DATA_DIR / "brand"  # custom fonts added in the brand kit (copied there by Electron)
WEIGHTS = (400, 600, 700, 800, 900)
_lock = threading.Lock()


class FontsMissing(Exception):
    pass


def fonts_dir() -> Path:
    return settings.cache_dir / "fonts"


def _family(font) -> str:
    name = font["name"]
    return str(name.getName(16, 3, 1, 0x409) or name.getName(1, 3, 1, 0x409))


def _size_factor(font) -> float:
    os2 = font["OS/2"]
    return (os2.usWinAscent + os2.usWinDescent) / font["head"].unitsPerEm


def _set_names(font, family: str, weight: int) -> None:
    style = {400: "Regular", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}[weight]
    name = font["name"]
    for nid, value in {1: family, 2: "Regular", 4: f"{family} {style}", 6: f"{family.replace(' ', '')}-{style}", 16: family, 17: style}.items():
        name.setName(value, nid, 3, 1, 0x409)
    font["OS/2"].usWeightClass = weight


def family_of(path: Path) -> str:
    """The family name libass will match (also used by the preview's @font-face)."""
    from fontTools.ttLib import TTFont

    return _family(TTFont(path))


def prepare() -> tuple[Path, dict[str, float]]:
    """Ensure static font files exist. Returns (fonts dir, {family: size factor})."""
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    out = fonts_dir()
    meta_file = out / "metrics.json"
    sources = sorted(SOURCE_DIR.glob("*.ttf")) + sorted(p for p in BRAND_DIR.glob("*") if p.suffix.lower() in (".ttf", ".otf"))
    if not sources:
        raise FontsMissing("Caption fonts are missing. Run `npm run fetch:fonts`.")
    with _lock:
        stamp = [f"{p.name}:{p.stat().st_size}" for p in sources]
        if meta_file.exists():
            meta = json.loads(meta_file.read_text("utf-8"))
            if meta.get("stamp") == stamp:
                return out, meta["factors"]
        out.mkdir(parents=True, exist_ok=True)
        factors: dict[str, float] = {}
        for src in sources:
            font = TTFont(src)
            family = _family(font)
            factors[family] = round(_size_factor(font), 4)
            if "fvar" not in font:
                if not (out / src.name).exists():
                    font.save(out / src.name)
                continue
            axes = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
            for w in WEIGHTS:
                target = out / f"{family.replace(' ', '')}-{w}.ttf"
                if target.exists():  # instancing is slow; only build what's missing
                    continue
                inst = instantiateVariableFont(TTFont(src), {**axes, "wght": w})
                _set_names(inst, family, w)
                inst.save(target)
            log.info("Built static instances for %s", family)
        meta_file.write_text(json.dumps({"stamp": stamp, "factors": factors}), "utf-8")
        return out, factors
