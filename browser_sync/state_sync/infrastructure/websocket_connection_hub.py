"""
WebSocket connection hub implementation.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Dict, Optional, Set

from browser_sync.state_sync.domain.contracts import IConnectionHub


class WebSocketConnectionHub(IConnectionHub):
    """
    Manages websocket rooms and broadcasts JSON messages.
    """

    def __init__(self):
        self._rooms: Dict[str, Set[Any]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, connection: Any) -> None:
        await connection.accept()
        async with self._lock:
            self._rooms[room_id].add(connection)

    async def disconnect(self, room_id: str, connection: Any) -> None:
        async with self._lock:
            room = self._rooms.get(room_id)
            if not room:
                return
            room.discard(connection)
            if not room:
                self._rooms.pop(room_id, None)

    async def send_to(self, connection: Any, payload: Dict[str, Any]) -> None:
        await connection.send_json(payload)

    async def broadcast(
        self,
        room_id: str,
        payload: Dict[str, Any],
        exclude: Optional[Any] = None,
    ) -> None:
        async with self._lock:
            targets = list(self._rooms.get(room_id, set()))

        dead_connections = []
        for connection in targets:
            if exclude is not None and connection is exclude:
                continue
            try:
                await connection.send_json(payload)
            except Exception:
                dead_connections.append(connection)

        if dead_connections:
            async with self._lock:
                room = self._rooms.get(room_id, set())
                for dead in dead_connections:
                    room.discard(dead)
                if not room:
                    self._rooms.pop(room_id, None)

