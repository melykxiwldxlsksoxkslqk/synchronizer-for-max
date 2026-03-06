# -*- coding: utf-8 -*-
"""
Доменная модель: WindowInfo — информация об окне ОС.
"""

from dataclasses import dataclass
from typing import Tuple


@dataclass
class WindowInfo:
    """
    Информация об окне.
    Entity — идентифицируется по hwnd.
    Чистая доменная модель без платформозависимых импортов.
    """
    hwnd: int
    title: str
    x: int
    y: int
    width: int
    height: int
    pid: int = 0

    @property
    def rect(self) -> Tuple[int, int, int, int]:
        """Прямоугольник окна (left, top, right, bottom)."""
        return (self.x, self.y, self.x + self.width, self.y + self.height)

    def is_valid(self) -> bool:
        """Проверяет, существует ли окно и видимо ли оно (делегирует в win32gui)."""
        try:
            import win32gui
            return win32gui.IsWindow(self.hwnd) and win32gui.IsWindowVisible(self.hwnd)
        except ImportError:
            return self.hwnd != 0

    def to_dict(self) -> dict:
        """Сериализация для передачи в UI."""
        return {
            "hwnd": self.hwnd,
            "title": self.title,
            "width": self.width,
            "height": self.height,
            "x": self.x,
            "y": self.y,
            "pid": self.pid,
        }

    def __eq__(self, other):
        if isinstance(other, WindowInfo):
            return self.hwnd == other.hwnd
        return NotImplemented

    def __hash__(self):
        return hash(self.hwnd)

    def __repr__(self):
        return (
            f"WindowInfo(hwnd={self.hwnd}, title='{self.title[:40]}...', "
            f"pos=({self.x},{self.y}), size={self.width}x{self.height})"
        )
