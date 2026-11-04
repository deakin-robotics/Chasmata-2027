"""ROS-independent storage and comparison for complete ECAM source snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


SOURCE_NAMES = ('driver', 'ecam', 'arm', 'basestation', 'rover')


@dataclass(frozen=True)
class SourceSnapshot:
    source: str
    timestamp: tuple[int, int]
    active_codes: tuple[str, ...]


class SourceSnapshotStore:
    """Keeps one latest complete snapshot for each known reporting source."""

    def __init__(self) -> None:
        self._snapshots: dict[str, SourceSnapshot] = {}

    def update(
        self,
        source: str,
        timestamp: tuple[int, int],
        active_codes: Iterable[str],
    ) -> bool:
        if source not in SOURCE_NAMES:
            return False

        current = self._snapshots.get(source)
        if current is not None and timestamp < current.timestamp:
            return False

        normalized_codes = tuple(sorted({code.strip() for code in active_codes if code.strip()}))
        snapshot = SourceSnapshot(source, timestamp, normalized_codes)
        changed = self._snapshots.get(source) != snapshot
        self._snapshots[source] = snapshot
        return changed

    def get(self, source: str) -> SourceSnapshot | None:
        return self._snapshots.get(source)

    def snapshots(self) -> tuple[SourceSnapshot, ...]:
        return tuple(
            self._snapshots[source]
            for source in SOURCE_NAMES
            if source in self._snapshots
        )

    def active_codes(self) -> tuple[str, ...]:
        return tuple(sorted({
            code
            for snapshot in self._snapshots.values()
            for code in snapshot.active_codes
        }))

    def reflects(self, expected: 'SourceSnapshotStore', *, exclude: str = 'rover') -> bool:
        """Return whether this store contains every expected source snapshot."""
        for source in SOURCE_NAMES:
            if source == exclude:
                continue
            expected_snapshot = expected.get(source)
            if expected_snapshot is not None and self.get(source) != expected_snapshot:
                return False
        return True
