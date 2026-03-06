# -*- coding: utf-8 -*-
"""
Интерфейс: IWindowService — контракт сервиса управления окнами.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from browser_sync.core.models.window import WindowInfo


class IWindowService(ABC):
    """Контракт сервиса работы с окнами ОС."""

    @abstractmethod
    def scan_browser_windows(self, keywords: List[str]) -> List[WindowInfo]:
        """Найти все окна браузера по ключевым словам."""
        ...

    @abstractmethod
    def get_foreground_window(self) -> Optional[WindowInfo]:
        """Получить текущее активное окно."""
        ...

    @abstractmethod
    def get_window_info(self, hwnd: int) -> Optional[WindowInfo]:
        """Получить информацию об окне по HWND."""
        ...

    @abstractmethod
    def activate_window(self, hwnd: int) -> None:
        """Активировать окно."""
        ...

    @abstractmethod
    def absolute_to_relative(self, x: int, y: int, window: WindowInfo) -> tuple:
        """Абсолютные → относительные координаты."""
        ...

    @abstractmethod
    def relative_to_absolute(self, rel_x: float, rel_y: float, window: WindowInfo) -> tuple:
        """Относительные → абсолютные координаты."""
        ...
