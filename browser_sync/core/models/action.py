# -*- coding: utf-8 -*-
"""
Доменная модель: Action — единица пользовательского действия.
Чистая модель данных без зависимостей от фреймворков.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List


class ActionType(Enum):
    """Типы действий пользователя."""
    MOUSE_CLICK = "mouse_click"
    MOUSE_DOUBLE_CLICK = "mouse_double_click"
    MOUSE_MOVE = "mouse_move"
    MOUSE_SCROLL = "mouse_scroll"
    KEY_PRESS = "key_press"
    KEY_RELEASE = "key_release"
    KEY_TYPE = "key_type"
    FILE_UPLOAD = "file_upload"


@dataclass
class Action:
    """
    Одно действие пользователя.
    Value Object — неизменяемый объект данных.
    """
    action_type: ActionType
    timestamp: float

    # Координаты мыши (абсолютные)
    x: int = 0
    y: int = 0
    button: str = "left"
    scroll_dx: int = 0
    scroll_dy: int = 0

    # Относительные координаты (0.0 — 1.0)
    rel_x: float = 0.0
    rel_y: float = 0.0

    # Клавиатура
    key: Optional[str] = None
    key_char: Optional[str] = None
    vk_code: Optional[int] = None
    scan_code: Optional[int] = None
    is_special: bool = False

    # Загрузка файлов
    file_paths: Optional[List[str]] = None

    # Источник действия
    source_hwnd: int = 0

    def is_mouse_action(self) -> bool:
        """Является ли действие действием мыши."""
        return self.action_type.value.startswith("mouse")

    def is_keyboard_action(self) -> bool:
        """Является ли действие действием клавиатуры."""
        return self.action_type.value.startswith("key")

    def describe(self) -> str:
        """Текстовое описание для лога."""
        if self.is_mouse_action():
            return f"🖱 {self.action_type.value}: ({self.x}, {self.y}) btn={self.button}"
        elif self.is_keyboard_action():
            key_info = self.key_char or self.key or "?"
            return f"⌨ {self.action_type.value}: '{key_info}'"
        elif self.action_type == ActionType.FILE_UPLOAD:
            count = len(self.file_paths) if self.file_paths else 0
            return f"📂 file_upload: {count} файл(ов)"
        return f"❓ {self.action_type.value}"
