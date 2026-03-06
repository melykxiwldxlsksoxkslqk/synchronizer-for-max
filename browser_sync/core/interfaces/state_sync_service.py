# -*- coding: utf-8 -*-
"""
Интерфейс: IStateSyncService — контракт сервиса state-sync сервера.
"""

from abc import ABC, abstractmethod
from typing import Callable, Optional


class IStateSyncService(ABC):
    """Контракт управления state-sync websocket сервером."""

    @abstractmethod
    def start(
        self,
        host: str,
        port: int,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """Запустить websocket сервер."""
        ...

    @abstractmethod
    def stop(self) -> None:
        """Остановить websocket сервер."""
        ...

    @property
    @abstractmethod
    def is_running(self) -> bool:
        """Флаг запущенного сервера."""
        ...

    @abstractmethod
    def build_room_ws_url(self, room_id: str, host: str, port: int) -> str:
        """Построить websocket URL для комнаты."""
        ...

    @abstractmethod
    def get_diagnostics(self) -> dict:
        """Получить диагностику websocket активности."""
        ...

