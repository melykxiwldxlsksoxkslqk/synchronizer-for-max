"""
Abstract contracts for state sync infrastructure.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from .models import FieldUpdate


class IStateRepository(ABC):
    """
    Contract for storing and updating room state.
    """

    @abstractmethod
    async def get_snapshot(self, room_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def apply_field_update(
        self,
        room_id: str,
        update: FieldUpdate,
    ) -> Dict[str, Any]:
        pass


class IConnectionHub(ABC):
    """
    Contract for websocket connection lifecycle and message delivery.
    """

    @abstractmethod
    async def connect(self, room_id: str, connection: Any) -> None:
        pass

    @abstractmethod
    async def disconnect(self, room_id: str, connection: Any) -> None:
        pass

    @abstractmethod
    async def send_to(self, connection: Any, payload: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    async def broadcast(
        self,
        room_id: str,
        payload: Dict[str, Any],
        exclude: Optional[Any] = None,
    ) -> None:
        pass

