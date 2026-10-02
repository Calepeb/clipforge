"""ASS subtitle generation for burned-in captions and text layers.

Mirrors the editor preview (src/features/captions/CaptionRender.tsx, src/lib/captions.ts):
same chunking, positions, sizes (relative to a 1080px-wide frame), colours, outline,
shadow, word highlight, keyword colours, emojis and entrance animations. Known gaps:
libass has no shadow blur and draws emojis in monochrome.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

REF_WIDTH = 1080
PAUSE_BREAK = 0.6     # same as the editor's chunking
LINGER = 0.12         # chunks stay up this long after their last word (editor: chunkAt)
EMOJI_FONT = "Segoe UI Emoji"

KEYWORDS = {
    "never", "always", "secret", "money", "million", "insane", "crazy", "biggest", "worst", "best", "mistake",
    "truth", "free", "nobody", "everyone", "wrong", "love", "hate", "fail", "win", "stop", "why", "actually",
    "impossible", "huge",
}
EMOJI = {
    "money": "💰", "million": "💰", "fire": "🔥", "crazy": "🤯", "insane": "🤯", "love": "❤️", "laugh": "😂",
    "funny": "😂", "secret": "🤫", "mistake": "😬", "win": "🏆", "fail": "💀", "idea": "💡", "stop": "✋",
    "wrong": "❌", "truth": "👀", "time": "⏰", "biggest": "🚀",
}


@dataclass
class Word:
    text: str
    start: float
    end: float


def _key(t: str) -> str:
    return re.sub(r"[^a-z]", "", t.lower())


def chunk_words(words: list[Word], per_chunk: int) -> list[list[Word]]:
    """Port of chunkWords() in src/lib/captions.ts — keep the two in sync."""
    chunks: list[list[Word]] = []
    cur: list[Word] = []
    for w in words:
        prev = cur[-1] if cur else None
        if prev and (w.start - prev.end > PAUSE_BREAK or re.search(r"[.!?]$", prev.text) or len(cur) >= per_chunk):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def color(hex_color: str, alpha: int = 0) -> str:
    """'#rrggbb' -> ASS '&HAABBGGRR' (alpha 0 = opaque)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ts(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def escape(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", "\\N")


class AssBuilder:
    def __init__(self, width: int, height: int, factors: dict[str, float]):
        self.w, self.h = width, height
        self.scale = width / REF_WIDTH
        self.factors = factors
        self.events: list[str] = []

    def font_size(self, family: str, css_px: float) -> float:
        """ASS size that renders like CSS `font-size: css_px` (see fonts.py)."""
        return round(css_px * self.scale * self.factors.get(family, 1.25), 2)

    # ---------------------------------------------------------------- captions
    def add_captions(self, words: list[Word], s: dict) -> None:
        family = s["fontFamily"]
        fs = self.font_size(family, s["fontSize"])
        x, y = s["x"] * self.w, s["y"] * self.h
        bord = s["outlineWidth"] * self.scale
        shadow = 4 * self.scale if s["shadow"] else 0
        base = (
            f"\\an5\\fn{family}\\fs{fs}\\b{s['fontWeight']}\\1c{color(s['textColor'])}\\3c{color(s['outlineColor'])}"
            f"\\4c&H000000&\\4a&H59&\\bord{bord:.2f}\\shad{shadow:.2f}"
        )
        anim = s["animation"]
        chunks = chunk_words(words, int(s["wordsPerChunk"]))
        shown_until = 0.0
        for chunk in chunks:
            # Like the editor, a chunk lingers briefly; the next one starts once it's gone.
            start = max(chunk[0].start, shown_until)
            end = chunk[-1].end + LINGER
            if end <= start:
                continue
            shown_until = end
            per_word = s["highlightMode"] == "word" or anim == "typewriter"
            cuts = sorted({start, end, *[t for w in chunk for t in (w.start, w.end) if start < t < end]}) if per_word else [start, end]
            for k in range(len(cuts) - 1):
                a, b = cuts[k], cuts[k + 1]
                first = k == 0
                pos = f"\\pos({x:.1f},{y:.1f})"
                entrance = ""
                if first and anim == "pop":
                    entrance = "\\fscx60\\fscy60\\alpha&HFF&\\t(0,180,\\fscx108\\fscy108\\alpha&H00&)\\t(180,260,\\fscx100\\fscy100)"
                elif first and anim == "bounce":
                    pos = f"\\move({x:.1f},{y + 0.4 * fs:.1f},{x:.1f},{y:.1f},0,240)"
                    entrance = "\\fad(120,0)"
                elif first and anim == "fade":
                    entrance = "\\fad(240,0)"
                text = self._caption_text(chunk, a, s, family, bord, animated=first and anim in ("pop", "bounce"))
                if text:
                    self._event(a, b, f"{{{base}{pos}{entrance}}}{text}")

    def _caption_text(self, chunk: list[Word], t: float, s: dict, family: str, bord: float, animated: bool) -> str:
        visible = [w for w in chunk if w.start <= t + 1e-3] if s["animation"] == "typewriter" else chunk
        parts = []
        for w in visible:
            label = w.text.upper() if s["uppercase"] else w.text
            tags = ""
            active = s["highlightMode"] == "word" and w.start <= t + 1e-3 < w.end
            if active:
                tags = f"\\1c{color(s['highlightColor'])}" + ("" if animated else "\\fscx108\\fscy108")
            elif s["keywordEmphasis"] and _key(w.text) in KEYWORDS:
                tags = f"\\1c{color(s['keywordColor'])}"
            reset = f"\\1c{color(s['textColor'])}\\fscx100\\fscy100" if tags else ""
            piece = f"{{{tags}}}{escape(label)}{{{reset}}}" if tags else escape(label)
            if s["emojis"] and (e := EMOJI.get(_key(w.text))):
                piece += f"{{\\fn{EMOJI_FONT}\\bord0\\shad0}} {e}{{\\fn{family}\\bord{bord:.2f}}}"
            parts.append(piece)
        return " ".join(parts)

    # -------------------------------------------------------------- text layers
    def add_text(self, item: dict) -> None:
        family = item["fontFamily"]
        fs = self.font_size(family, item["fontSize"])
        x, y = item["x"] * self.w, item["y"] * self.h
        tags = f"\\an5\\pos({x:.1f},{y:.1f})\\fn{family}\\fs{fs}\\b800\\1c{color(item['color'])}"
        if item.get("background"):
            # Opaque box (style "Box" uses BorderStyle 3): outline colour = box colour, \bord = padding.
            tags += f"\\3c{color(item['background'])}\\bord{18 * self.scale:.1f}\\shad0"
            style = "Box"
        else:
            tags += f"\\4c&H000000&\\4a&H66&\\bord0\\shad{3 * self.scale:.1f}"
            style = "Text"
        if item.get("isHook"):
            tags += "\\fscx60\\fscy60\\alpha&HFF&\\t(0,200,\\fscx108\\fscy108\\alpha&H00&)\\t(200,320,\\fscx100\\fscy100)"
        self._event(item["start"], item["end"], f"{{{tags}}}{escape(item['text'])}", style)

    # ------------------------------------------------------------------ output
    def _event(self, start: float, end: float, text: str, style: str = "Caption") -> None:
        self.events.append(f"Dialogue: 0,{ts(start)},{ts(end)},{style},,0,0,0,,{text}")

    def build(self) -> str:
        margin = round(self.w * 0.05)
        text_margin = round(self.w * 0.06)
        styles = [
            f"Style: Caption,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H59000000,0,0,0,0,100,100,0,0,1,0,0,5,{margin},{margin},0,1",
            f"Style: Text,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,0,0,0,0,100,100,0,0,1,0,0,5,{text_margin},{text_margin},0,1",
            f"Style: Box,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,0,0,5,{text_margin},{text_margin},0,1",
        ]
        return "\n".join([
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {self.w}",
            f"PlayResY: {self.h}",
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            "YCbCr Matrix: TV.709",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            *styles,
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *self.events,
            "",
        ])
