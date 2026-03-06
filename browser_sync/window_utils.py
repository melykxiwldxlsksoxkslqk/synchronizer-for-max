# -*- coding: utf-8 -*-
"""
DEPRECATED: Этот модуль оставлен для обратной совместимости.
Используйте browser_sync.adapters.win32.window_service и browser_sync.core.models.window.
"""
from browser_sync.core.models.window import WindowInfo  # noqa: F401
from browser_sync.adapters.win32.window_service import Win32WindowService  # noqa: F401
from browser_sync.adapters.win32.input_sender import Win32InputSender  # noqa: F401
