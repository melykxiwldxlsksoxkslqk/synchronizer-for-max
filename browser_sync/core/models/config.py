# -*- coding: utf-8 -*-
"""
Доменная модель: SyncConfig — конфигурация синхронизации.
"""

import json
import os
from dataclasses import dataclass, field, asdict
from typing import List


CONFIG_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "config.json"
)


@dataclass
class SyncConfig:
    """
    Настройки синхронизации.
    Value Object — набор параметров.
    """
    action_delay: float = 0.05
    random_delay: float = 0.02
    sync_mouse_clicks: bool = True
    sync_mouse_move: bool = False
    sync_mouse_scroll: bool = True
    sync_keyboard: bool = True
    hotkey_toggle: str = "F6"
    hotkey_pause: str = "F7"
    hotkey_exit: str = "F8"
    use_relative_coords: bool = True
    browser_window_keywords: List[str] = field(
        default_factory=lambda: ["Chrome", "Edge", "Firefox", "Opera", "Brave", "Chromium", "Multilogin", "Mirroring"]
    )
    exclude_master: bool = True
    enable_logging: bool = True
    replay_delay_ms: int = 50
    upload_file_paths: List[str] = field(default_factory=list)
    enable_dom_state_sync: bool = True
    state_sync_only: bool = True
    state_sync_host: str = "127.0.0.1"
    state_sync_port: int = 8000
    state_sync_room: str = "default-room"

    def save(self, path: str = None):
        """Сохранить конфигурацию в файл."""
        path = path or CONFIG_FILE
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls, path: str = None) -> "SyncConfig":
        """Загрузить конфигурацию из файла."""
        path = path or CONFIG_FILE
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
            except Exception:
                pass
        return cls()

    def get_hotkeys_set(self) -> set:
        """Множество горячих клавиш для исключения из синхронизации."""
        return {self.hotkey_toggle, self.hotkey_pause, self.hotkey_exit}
