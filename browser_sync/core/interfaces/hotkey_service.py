# -*- coding: utf-8 -*-
"""
Интерфейс: IHotkeyService — контракт сервиса горячих клавиш.
"""

from abc import ABC, abstractmethod
from typing import Callable


class IHotkeyService(ABC):
    """Контракт сервиса управления горячими клавишами."""

    @abstractmethod
    def register(self, key: str, callback: Callable) -> None:
        """Зарегистрировать горячую клавишу."""
        ...

    @abstractmethod
    def unregister_all(self) -> None:
        """Удалить все горячие клавиши."""
        ...
