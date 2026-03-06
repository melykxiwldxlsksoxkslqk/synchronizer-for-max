"""
In-memory state repository implementation.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict

from browser_sync.state_sync.domain.contracts import IStateRepository
from browser_sync.state_sync.domain.models import FieldUpdate, SessionState


class InMemoryStateRepository(IStateRepository):
    """
    Thread-safe async in-memory room state storage.
    """

    def __init__(self):
        self._states: Dict[str, SessionState] = {}
        self._lock = asyncio.Lock()

    async def get_snapshot(self, room_id: str) -> Dict[str, Any]:
        async with self._lock:
            state = self._states.get(room_id)
            if state is None:
                state = SessionState(room_id=room_id)
                self._states[room_id] = state
            return state.snapshot()

    async def apply_field_update(
        self,
        room_id: str,
        update: FieldUpdate,
    ) -> Dict[str, Any]:
        async with self._lock:
            state = self._states.get(room_id)
            if state is None:
                state = SessionState(room_id=room_id)
                self._states[room_id] = state
            state.apply(update)
            return state.snapshot()

