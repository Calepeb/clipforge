"""Hook text, title, reason and hashtags for each clip — written by Claude, with a local fallback."""
from __future__ import annotations

import logging
import re

import anthropic
from pydantic import BaseModel, Field, ValidationError

from .analysis.selection import Candidate
from .config import settings

log = logging.getLogger(__name__)


class ClipCopy(BaseModel):
    index: int
    hook: str = Field(description="On-screen hook for the first 3 seconds, max 8 words")
    title: str = Field(description="Short title, max 6 words, used as the filename")
    reason: str = Field(description="One sentence on why this moment could go viral")
    hashtags: list[str] = Field(description="3-5 relevant hashtags, each starting with #")


class CopyBatch(BaseModel):
    clips: list[ClipCopy]


SYSTEM = (
    "You write on-screen copy for short vertical videos (TikTok/Reels) cut from longer videos. "
    "For each clip transcript you get, write:\n"
    "- hook: the text shown in the first 3 seconds. Max 8 words. Create curiosity or tension that the clip pays off. "
    "Write it in the same language as the transcript. No emojis, no hashtags, no quotation marks, no clickbait that the clip doesn't deliver.\n"
    "- title: max 6 words, plain and specific.\n"
    "- reason: one sentence explaining what makes the moment engaging.\n"
    "- hashtags: 3-5 relevant hashtags.\n"
    "Return one entry per clip, using the clip's index."
)


_DANGLING = {"a", "an", "the", "to", "of", "and", "or", "but", "you", "i", "we", "with", "from", "for", "in", "on", "at", "is", "was", "that", "this", "my", "your"}


def _trim(words: list[str], limit: int) -> list[str]:
    """First `limit` words, without trailing filler like 'the' or 'you'."""
    out = words[:limit]
    while len(out) > 2 and re.sub(r"[^\w']", "", out[-1].lower()) in _DANGLING:
        out.pop()
    return out


def _fallback(p: Candidate) -> ClipCopy:
    """Strongest opening line from the transcript, trimmed to a short phrase."""
    words = p.sentences[0].text.split()
    short = _trim(words, 8)
    hook = " ".join(short).rstrip(",;:") + ("…" if len(short) < len(words) else "")
    title = re.sub(r"[^\w\s'$%-]", "", " ".join(_trim(words, 6))).strip().title() or "Clip"
    return ClipCopy(index=0, hook=hook, title=title, reason="Opens on a strong line and ends on a complete thought.", hashtags=["#fyp", "#viral"])


def write_copy(picks: list[Candidate], language: str) -> tuple[list[ClipCopy], str | None]:
    """Returns one ClipCopy per pick (same order) and a warning if the fallback was used."""
    fallback = [_fallback(p).model_copy(update={"index": i}) for i, p in enumerate(picks)]
    if not settings.anthropic_api_key:
        return fallback, "No ANTHROPIC_API_KEY set; hooks and titles come from the transcript."

    prompt = f"Transcript language code: {language}\n\n" + "\n\n".join(
        f'<clip index="{i}" duration="{p.end - p.start:.0f}s">\n{p.text}\n</clip>' for i, p in enumerate(picks)
    )
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.parse(
            model=settings.claude_model,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low"},
            output_format=CopyBatch,
        )
    except anthropic.AuthenticationError:
        log.error("Claude rejected the API key")
        return fallback, "Claude rejected the API key in .env; hooks come from the transcript."
    except anthropic.RateLimitError:
        log.warning("Claude rate limited")
        return fallback, "Claude is rate limited right now; hooks come from the transcript."
    except anthropic.APIStatusError as e:
        log.error("Claude API error %s: %s", e.status_code, e.message)
        return fallback, f"Claude API error ({e.status_code}); hooks come from the transcript."
    except anthropic.APIConnectionError:
        log.warning("Could not reach Claude")
        return fallback, "Couldn't reach Claude (offline?); hooks come from the transcript."
    except ValidationError:
        log.exception("Claude returned copy that doesn't match the schema")
        return fallback, "Claude returned an unexpected response; hooks come from the transcript."

    if response.stop_reason == "refusal" or response.parsed_output is None:
        log.warning("Claude returned no usable output (stop_reason=%s)", response.stop_reason)
        return fallback, "Claude didn't return hooks for these clips; hooks come from the transcript."

    by_index = {c.index: c for c in response.parsed_output.clips}
    result = [by_index.get(i, fallback[i]) for i in range(len(picks))]
    for c in result:
        c.hashtags = [h if h.startswith("#") else f"#{h}" for h in c.hashtags][:5]
    log.info("Claude wrote copy for %d/%d clips", len(by_index), len(picks))
    return result, None
