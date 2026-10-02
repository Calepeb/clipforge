"""Claude reads the transcript and proposes standout moments with per-dimension scores.

Long transcripts are split into overlapping chunks analysed in parallel. Each moment is
expressed as a sentence range so it always starts and ends on sentence boundaries.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable

import anthropic
from pydantic import BaseModel, Field, ValidationError

from ..config import settings
from .text import Sentence

log = logging.getLogger(__name__)

CHUNK_SECONDS = 8 * 60
OVERLAP_SECONDS = 60
MAX_PARALLEL = 4

DIMENSIONS = ("hook", "opinion", "humor", "emotion", "surprise", "story")


class MomentOut(BaseModel):
    start_sentence: int = Field(description="Index of the first sentence; must be a strong opening hook")
    end_sentence: int = Field(description="Index of the last sentence; completes the payoff")
    hook: int = Field(description="0-10: does the first line make viewers stop scrolling?")
    opinion: int = Field(description="0-10: strong or contrarian opinion")
    humor: int = Field(description="0-10: genuinely funny")
    emotion: int = Field(description="0-10: emotional or vulnerable moment")
    surprise: int = Field(description="0-10: surprising fact or reveal")
    story: int = Field(description="0-10: complete mini story arc with a payoff")
    virality: int = Field(description="0-100: overall chance this works as a standalone short")
    reason: str = Field(description="One sentence: why this moment could go viral")
    hook_text: str = Field(description="On-screen hook for the first 3 seconds, max 8 words, transcript language")
    title: str = Field(description="Short specific title, max 6 words")
    hashtags: list[str] = Field(description="3-5 relevant hashtags starting with #")


class MomentsOut(BaseModel):
    moments: list[MomentOut]


@dataclass
class Moment:
    start_sentence: int
    end_sentence: int
    dims: dict[str, float]       # 0..1 per dimension
    virality: float              # 0..1
    reason: str
    hook_text: str
    title: str
    hashtags: list[str]


SYSTEM = """You are a short-form video editor who finds the moments in long videos that will perform best as standalone TikTok/Reels/Shorts clips.

You get a transcript split into numbered sentences with timestamps. Propose standout moments, each a contiguous sentence range that:
- starts on a line that hooks a scrolling viewer immediately (no slow wind-up, no references to earlier context like "as I said"),
- ends right after the payoff, on a complete sentence,
- makes sense on its own to someone who hasn't seen the rest of the video,
- lasts between {min_len:.0f} and {max_len:.0f} seconds (use the timestamps).

Look for: strong hooks, bold or contrarian opinions, humor, emotional or vulnerable moments, surprising facts, and story arcs with a payoff. Moments must not overlap each other. Score honestly; most moments are not a 90+.

For each moment also write the on-screen hook (max 8 words, in the transcript's language, no emojis/hashtags/quotes, never promising something the clip doesn't deliver), a short title, a one-sentence reason, and 3-5 hashtags."""


def _fmt(t: float) -> str:
    return f"{int(t // 60):02d}:{t % 60:04.1f}"


def _chunks(sents: list[Sentence]) -> list[tuple[int, int]]:
    """Sentence index ranges [a, b) covering the transcript with overlap."""
    out: list[tuple[int, int]] = []
    a = 0
    while a < len(sents):
        b = a
        while b < len(sents) and sents[b].end - sents[a].start < CHUNK_SECONDS:
            b += 1
        b = max(b, a + 1)
        out.append((a, b))
        if b >= len(sents):
            break
        # step back so moments spanning the boundary are seen whole in the next chunk
        nxt = b
        while nxt > a + 1 and sents[b - 1].end - sents[nxt - 1].start < OVERLAP_SECONDS:
            nxt -= 1
        a = nxt
    return out


def _analyze_chunk(client: anthropic.Anthropic, sents: list[Sentence], a: int, b: int, want: int, min_len: float, max_len: float, language: str) -> list[Moment]:
    lines = "\n".join(f"[{i}] {_fmt(sents[i].start)}-{_fmt(sents[i].end)} {sents[i].text}" for i in range(a, b))
    prompt = (
        f"Transcript language: {language}\n"
        f"Propose up to {want} moments from sentences {a}-{b - 1}.\n\n<transcript>\n{lines}\n</transcript>"
    )
    response = client.messages.parse(
        model=settings.claude_model,
        max_tokens=16000,
        system=SYSTEM.format(min_len=min_len, max_len=max_len),
        messages=[{"role": "user", "content": prompt}],
        output_config={"effort": "medium"},
        output_format=MomentsOut,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        log.warning("Chunk %d-%d: no usable output (stop_reason=%s)", a, b, response.stop_reason)
        return []
    moments = []
    for m in response.parsed_output.moments:
        s, e = max(a, m.start_sentence), min(b - 1, m.end_sentence)
        if e < s:
            continue
        moments.append(Moment(
            start_sentence=s, end_sentence=e,
            dims={d: max(0, min(10, getattr(m, d))) / 10 for d in DIMENSIONS},
            virality=max(0, min(100, m.virality)) / 100,
            reason=m.reason.strip(), hook_text=m.hook_text.strip(), title=m.title.strip(),
            hashtags=[h if h.startswith("#") else f"#{h}" for h in m.hashtags][:5],
        ))
    return moments


def find_moments(
    sents: list[Sentence], count: int, min_len: float, max_len: float, language: str,
    on_progress: Callable[[float], None], cancelled: Callable[[], bool],
) -> tuple[list[Moment], str | None]:
    """Returns (moments, warning). An empty list with a warning means Claude was unavailable."""
    if not settings.anthropic_api_key:
        return [], "No ANTHROPIC_API_KEY set, so moments were scored without Claude."
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3)
    chunks = _chunks(sents)
    total_dur = max(1.0, sents[-1].end - sents[0].start)
    moments: list[Moment] = []
    failures: list[str] = []

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        futures = {}
        for a, b in chunks:
            share = (sents[b - 1].end - sents[a].start) / total_dur
            want = max(3, round(count * 1.6 * share) + 1)  # ask for spares so selection has choice
            futures[pool.submit(_analyze_chunk, client, sents, a, b, want, min_len, max_len, language)] = (a, b)
        for i, fut in enumerate(as_completed(futures), 1):
            if cancelled():
                for f in futures:
                    f.cancel()
                raise InterruptedError()
            try:
                moments.extend(fut.result())
            except anthropic.AuthenticationError:
                failures.append("Claude rejected the API key in .env")
            except anthropic.RateLimitError:
                failures.append("Claude is rate limited")
            except anthropic.APIStatusError as e:
                log.error("Claude API error %s: %s", e.status_code, e.message)
                failures.append(f"Claude API error {e.status_code}")
            except anthropic.APIConnectionError:
                failures.append("couldn't reach Claude (offline?)")
            except ValidationError:
                log.exception("Claude returned moments that don't match the schema")
                failures.append("unexpected response from Claude")
            on_progress(i / len(futures))

    log.info("Claude proposed %d moments from %d chunks (%d failed)", len(moments), len(chunks), len(failures))
    warning = None
    if failures:
        reason = sorted(set(failures))[0]
        warning = (
            f"Claude analysis failed ({reason}), so moments were scored without it."
            if not moments
            else f"Claude analysed only part of the video ({reason}); the rest was scored without it."
        )
    return moments, warning
