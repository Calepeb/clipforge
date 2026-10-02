"""Candidate generation and non-overlapping selection of the final clips."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import audio as audio_mod
from . import scenes as scenes_mod
from . import scoring
from . import text as text_mod
from .llm import DIMENSIONS, Moment
from .text import Sentence

MAX_ENDS_PER_START = 12  # bounds candidate count on long videos
MIN_MOMENT_IOU = 0.5     # a pick "comes from" a Claude moment above this overlap


class NotEnoughSpeech(Exception):
    pass


@dataclass
class Candidate:
    i: int
    j: int
    sentences: list[Sentence] = field(repr=False)
    moment: Moment | None = None
    signals: dict[str, float | None] = field(default_factory=dict)
    score: float = 0.0

    @property
    def start(self) -> float:
        return self.sentences[0].start

    @property
    def end(self) -> float:
        return self.sentences[-1].end

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.sentences)

    @property
    def words(self):
        return [w for s in self.sentences for w in s.words]


def _snap(sents: list[Sentence], i: int, j: int, min_len: float, max_len: float) -> tuple[int, int] | None:
    """Fit a sentence range into [min_len, max_len]: extend the end first (keeps the hook), then the start."""
    dur = lambda: sents[j].end - sents[i].start  # noqa: E731
    while dur() < min_len and j + 1 < len(sents):
        j += 1
    while dur() < min_len and i > 0:
        i -= 1
    while dur() > max_len and j > i:
        j -= 1
    return (i, j) if min_len <= dur() <= max_len else None


def snap_moments(sents: list[Sentence], moments: list[Moment], min_len: float, max_len: float) -> list[tuple[Moment, int, int]]:
    """Claude's moments fitted to the allowed clip length (moments that can't fit are dropped)."""
    out = []
    for m in moments:
        if snapped := _snap(sents, m.start_sentence, m.end_sentence, min_len, max_len):
            out.append((m, *snapped))
    return out


def build_candidates(sents: list[Sentence], snapped: list[tuple[Moment, int, int]], min_len: float, max_len: float) -> list[Candidate]:
    ranges: set[tuple[int, int]] = {(i, j) for _, i, j in snapped}
    for i in range(len(sents)):
        ends = []
        for j in range(i, len(sents)):
            d = sents[j].end - sents[i].start
            if d > max_len:
                break
            if d >= min_len:
                ends.append(j)
        step = max(1, len(ends) // MAX_ENDS_PER_START)
        ranges.update((i, j) for j in ends[::step])
    return [Candidate(i=i, j=j, sentences=sents[i : j + 1]) for i, j in ranges]


def _moment_strength(m: Moment, w: dict) -> float:
    return scoring.weighted({"virality": m.virality, **m.dims}, w)


def score_candidates(
    cands: list[Candidate], snapped: list[tuple[Moment, int, int]], sents: list[Sentence],
    energy: audio_mod.AudioEnergy | None, visual: scenes_mod.VisualInfo | None,
    weights: dict, target: float, claude_used: bool,
) -> None:
    # Compare against the snapped range: that's the clip a moment actually becomes.
    strengths = [(m, _moment_strength(m, weights["llm"]), sents[i].start, sents[j].end) for m, i, j in snapped]
    for c in cands:
        # Claude signal: best moment weighted by how well this window matches it (IoU).
        llm: float | None = None
        if claude_used:
            llm, c.moment = 0.0, None
            for m, strength, ms, me in strengths:
                inter = max(0.0, min(c.end, me) - max(c.start, ms))
                iou = inter / (max(c.end, me) - min(c.start, ms))
                if iou * strength > llm:
                    llm = iou * strength
                    c.moment = m if iou >= MIN_MOMENT_IOU else c.moment
        t = text_mod.features(c.sentences)
        t["length"] = scoring.length_feature(c.end - c.start, target)
        c.signals = {
            "llm": llm,
            "text": scoring.weighted(t, weights["text"]),
            "audio": scoring.weighted(audio_mod.features(energy, c.start, c.end), weights["audio"]) if energy else None,
            "visual": scoring.weighted(scenes_mod.features(visual, c.start, c.end), weights["visual"]) if visual else None,
        }
        c.score = scoring.combine(c.signals, weights["signals"])


def _select(cands: list[Candidate], count: int) -> list[Candidate]:
    chosen: list[Candidate] = []
    for c in sorted(cands, key=lambda c: -c.score):
        if all(c.j < o.i or c.i > o.j for o in chosen):
            chosen.append(c)
            if len(chosen) == count:
                break
    return chosen


def pick_clips(
    sents: list[Sentence], moments: list[Moment], count: int, min_len: float, max_len: float,
    energy: audio_mod.AudioEnergy | None, visual: scenes_mod.VisualInfo | None, claude_used: bool,
) -> tuple[list[Candidate], str | None]:
    """Best non-overlapping clips. If the preferred length can't yield `count` clips,
    shorter preferred lengths are tried so short videos still get as many as fit."""
    if not sents:
        raise NotEnoughSpeech("No speech was detected in this video.")
    snapped = snap_moments(sents, moments, min_len, max_len)
    cands = build_candidates(sents, snapped, min_len, max_len)
    if not cands:
        raise NotEnoughSpeech(f"The speech in this video is shorter than the {min_len:.0f}s minimum clip length.")

    weights = scoring.load_weights()
    preferred = max(min_len, min(float(weights["length"]["target"]), max_len))
    best: list[Candidate] = []
    for target in dict.fromkeys([preferred, (preferred + min_len) / 2, min_len]):
        score_candidates(cands, snapped, sents, energy, visual, weights, target, claude_used)
        chosen = _select(cands, count)
        if len(chosen) > len(best):
            best = chosen
        if len(chosen) >= count:
            break

    note = None
    if len(best) < count:
        speech = sum(s.end - s.start for s in sents)
        note = (
            f"Only {len(best)} non-overlapping clips fit: the video has about {speech / 60:.1f} min of speech "
            f"and each clip needs {min_len:.0f}–{max_len:.0f}s."
        )
    return sorted(best, key=lambda c: -c.score), note


def explain(c: Candidate) -> list[str]:
    """Short human-readable signal highlights for the 'why' tooltip."""
    notes = []
    if c.moment:
        top = sorted(((c.moment.dims[d], d) for d in DIMENSIONS), reverse=True)[:2]
        notes += [f"strong {d}" for v, d in top if v >= 0.6]
    if (c.signals.get("audio") or 0) >= 0.55:
        notes.append("energetic delivery")
    if (c.signals.get("visual") or 0) >= 0.55:
        notes.append("lots of visual movement")
    return notes
