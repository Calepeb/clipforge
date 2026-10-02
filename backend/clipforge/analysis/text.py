"""Sentence segmentation and transcript-only features (work without Claude)."""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..transcription import Word

SENTENCE_GAP = 0.8  # seconds of silence that also ends a sentence
HOOK_WORDS = {
    "you", "your", "never", "always", "secret", "why", "how", "what", "mistake", "nobody", "everyone",
    "best", "worst", "biggest", "truth", "stop", "wrong", "actually", "crazy", "insane", "money",
    "million", "free", "imagine", "here's", "listen", "honestly", "problem", "fail", "hate", "love",
}


@dataclass
class Sentence:
    words: list[Word]

    @property
    def start(self) -> float:
        return self.words[0].start

    @property
    def end(self) -> float:
        return self.words[-1].end

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


def split_sentences(words: list[Word]) -> list[Sentence]:
    out: list[Sentence] = []
    cur: list[Word] = []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if re.search(r"[.!?…]$", w.text) or nxt is None or nxt.start - w.end > SENTENCE_GAP:
            out.append(Sentence(cur))
            cur = []
    return out


def _clean(t: str) -> str:
    return re.sub(r"[^\w']", "", t.lower())


def features(sents: list[Sentence]) -> dict[str, float]:
    """0..1 features: opening-line strength, speech pace, punchiness, clean ending."""
    first = sents[0]
    dur = sents[-1].end - first.start
    n_words = sum(len(s.words) for s in sents)
    first_words = [_clean(w.text) for w in first.words]
    text = " ".join(s.text for s in sents)

    hook = 0.25 * sum(w in HOOK_WORDS for w in first_words)
    if first.text.endswith("?"):
        hook += 0.4
    if len(first.words) <= 12:
        hook += 0.2
    return {
        "hook": min(1.0, hook),
        "pace": min(1.0, max(0.0, (n_words / dur - 1.6) / 1.6)) if dur else 0.0,
        "punch": min(1.0, 0.15 * (text.count("?") + text.count("!") + len(re.findall(r"\d", text)))),
        "ending": 1.0 if re.search(r"[.!?…]$", sents[-1].text) else 0.4,
    }
