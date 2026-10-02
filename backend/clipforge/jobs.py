"""Background jobs: run in worker threads, broadcast progress to WebSocket subscribers."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    kind: str
    label: str
    status: str = "running"  # running | done | error | cancelled
    stage: str = "Starting"
    progress: float = 0.0
    error: str | None = None
    result: Any = None
    created: float = field(default_factory=time.time)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "label": self.label, "status": self.status,
            "stage": self.stage, "progress": round(self.progress, 4), "error": self.error, "result": self.result,
        }


class JobContext:
    """Handed to job functions for progress reporting and cancellation checks."""

    def __init__(self, manager: "JobManager", job: Job):
        self._m = manager
        self._job = job
        self._last = 0.0

    def progress(self, fraction: float, stage: str | None = None) -> None:
        self._job.progress = max(0.0, min(1.0, fraction))
        if stage:
            self._job.stage = stage
        now = time.monotonic()
        if now - self._last > 0.2 or fraction >= 1:  # throttle broadcasts
            self._last = now
            self._m.broadcast(self._job)

    def cancelled(self) -> bool:
        return self._job.cancel_event.is_set()


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def broadcast(self, job: Job) -> None:
        if not self._loop:
            return
        msg = {"type": "job", "job": job.public()}

        def push() -> None:
            for q in list(self._subscribers):
                if not q.full():
                    q.put_nowait(msg)

        self._loop.call_soon_threadsafe(push)

    def start(self, kind: str, label: str, fn: Callable[[JobContext], Any]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, label=label)
        self.jobs[job.id] = job
        ctx = JobContext(self, job)

        def run() -> None:
            log.info("Job %s (%s) started: %s", job.id, kind, label)
            t0 = time.monotonic()
            try:
                job.result = fn(ctx)
                job.status, job.progress, job.stage = "done", 1.0, "Done"
                log.info("Job %s finished in %.1fs", job.id, time.monotonic() - t0)
            except JobCancelled:
                job.status, job.stage = "cancelled", "Cancelled"
                log.info("Job %s cancelled", job.id)
            except UserFacingError as e:
                job.status, job.error = "error", str(e)
                log.warning("Job %s failed: %s", job.id, e)
            except Exception as e:  # noqa: BLE001 - report every failure to the UI
                job.status, job.error = "error", f"Unexpected error: {e}"
                log.error("Job %s crashed:\n%s", job.id, traceback.format_exc())
            self.broadcast(job)

        threading.Thread(target=run, name=f"job-{job.id}", daemon=True).start()
        self.broadcast(job)
        return job

    def cancel(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or job.status != "running":
            return False
        job.cancel_event.set()
        return True


class JobCancelled(Exception):
    pass


class UserFacingError(Exception):
    """An error whose message is safe and useful to show in the UI."""
