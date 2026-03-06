# -*- coding: utf-8 -*-
"""
Интерфейс: IInputService — контракт сервиса захвата ввода.
"""

from abc import ABC, abstractmethod
from typing import Callable, Optional, Set


class IInputService(ABC):
    """Контракт сервиса захвата пользовательского ввода."""

    @abstractmethod
    def start(self) -> None:
        """Начать захват ввода."""
        ...

    @abstractmethod
    def stop(self) -> None:
        """Остановить захват."""
        ...

    @abstractmethod
    def pause(self) -> None:
        """Поставить на паузу."""
        ...

    @abstractmethod
    def resume(self) -> None:
        """Возобновить захват."""
        ...

    @abstractmethod
    def set_hotkeys(self, hotkeys: Set[str]) -> None:
        """Установить горячие клавиши, которые НЕ нужно синхронизировать."""
        ...

    @abstractmethod
    def set_capture_filter(self, filter_fn: Optional[Callable[[], bool]]) -> None:
        """Установить фильтр: должен вернуть True, если нужно захватывать."""
        ...

    @property
    @abstractmethod
    def is_running(self) -> bool:
        ...

    @property
    @abstractmethod
    def is_paused(self) -> bool:
        ...
