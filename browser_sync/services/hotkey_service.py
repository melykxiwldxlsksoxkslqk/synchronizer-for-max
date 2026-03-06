# -*- coding: utf-8 -*-
"""
HotkeyService — сервис управления горячими клавишами.
Реализует IHotkeyService.
"""

import logging
from typing import Callable

import keyboard as kb_module

from browser_sync.core.interfaces.hotkey_service import IHotkeyService

logger = logging.getLogger("BrowserSync.HotkeyService")


class HotkeyService(IHotkeyService):
    """
    Сервис горячих клавиш через библиотеку `keyboard`.
    SRP: только регистрация/снятие глобальных горячих клавиш.
    """

    def __init__(self):
        self._registered_keys: list = []

    def register(self, key: str, callback: Callable) -> None:
        """Зарегистрировать горячую клавишу."""
        try:
            kb_module.add_hotkey(key, callback)
            self._registered_keys.append(key)
            logger.info(f"Hotkey зарегистрирована: {key}")
        except Exception as e:
            logger.error(f"Ошибка регистрации hotkey '{key}': {e}")

    def unregister_all(self) -> None:
        """Удалить все горячие клавиши."""
        try:
            kb_module.unhook_all_hotkeys()
            self._registered_keys.clear()
            logger.info("Все hotkeys удалены")
        except Exception as e:
            logger.error(f"Ошибка удаления hotkeys: {e}")
