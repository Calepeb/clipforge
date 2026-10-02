"""Combines per-signal features into one virality score using scoring_weights.toml."""
from __future__ import annotations

import logging
import tomllib
from pathlib import Path

from ..config import DATA_DIR

log = logging.getLogger(__name__)

WEIGHTS_FILE = Path(__file__).with_name("scoring_weights.toml")
# Installed app: copy scoring_weights.toml into the app data folder to tune it there.
USER_WEIGHTS_FILE = DATA_DIR / "scoring_weights.toml"


def load_weights() -> dict:
    """Read fresh each run so tuning the TOML needs no restart."""
    path = USER_WEIGHTS_FILE if USER_WEIGHTS_FILE.exists() else WEIGHTS_FILE
    with path.open("rb") as f:
        return tomllib.load(f)


def weighted(features: dict[str, float], weights: dict[str, float]) -> float:
    """Weighted mean of the features present in `weights` (0..1)."""
    total = sum(weights.get(k, 0) for k in features)
    if total <= 0:
        return 0.0
    return sum(v * weights.get(k, 0) for k, v in features.items()) / total


def length_feature(duration: float, target: float) -> float:
    return max(0.0, 1 - abs(duration - target) / target)


def combine(signals: dict[str, float | None], weights: dict[str, float]) -> float:
    """Final 0..1 score over the signals that are available (None = unavailable)."""
    present = {k: v for k, v in signals.items() if v is not None and weights.get(k, 0) > 0}
    total = sum(weights[k] for k in present)
    return sum(v * weights[k] for k, v in present.items()) / total if total else 0.0


def to_percent(x: float) -> int:
    """Display score 0..100. The curve lifts mid scores a little so a good clip reads 70-85."""
    return round(100 * max(0.0, min(1.0, x)) ** 0.8)
