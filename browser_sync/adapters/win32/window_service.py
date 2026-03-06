# -*- coding: utf-8 -*-
"""
Win32WindowService — реализация IWindowService через Win32 API.
Отвечает за: поиск окон, получение информации, координаты.
"""

import ctypes
import ctypes.wintypes
import os
import logging
from typing import List, Optional, Tuple

import win32gui
import win32con
import win32api
import win32process

from browser_sync.core.interfaces.window_service import IWindowService
from browser_sync.core.models.window import WindowInfo

logger = logging.getLogger("BrowserSync.WindowService")

# Известные процессы браузеров
BROWSER_EXE_NAMES = {
    # Основные браузеры
    "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe",
    "vivaldi.exe", "chromium.exe", "safari.exe",
    # Яндекс-браузер (разные варианты)
    "yandex.exe", "browser.exe",
    # Антидетект браузеры
    "mimic.exe", "multilogin.exe", "gologin.exe", "octo-browser.exe",
    "adspower.exe", "incogniton.exe", "dolphin.exe",
    "onlymonsterbrowser.exe", "undetectable.exe",
    # Tor
    "tor.exe", "torbrowser.exe",
}

# Процессы-НЕ-браузеры на Electron/Chromium (чтобы не путать)
EXCLUDED_EXE_NAMES = {
    "code.exe",          # VS Code
    "discord.exe",       # Discord
    "slack.exe",         # Slack
    "teams.exe",         # Microsoft Teams
    "spotify.exe",       # Spotify
    "notion.exe",        # Notion
    "obsidian.exe",      # Obsidian
    "postman.exe",       # Postman
    "figma.exe",         # Figma
    "telegram.exe",      # Telegram Desktop
    "whatsapp.exe",      # WhatsApp Desktop
    "signal.exe",        # Signal
    "skype.exe",         # Skype
    "steam.exe",         # Steam
    "dota2.exe",         # Dota 2
    "explorer.exe",      # Windows Explorer
}

# Заголовки которые нужно исключить
EXCLUDE_TITLES = {"browsersync", "devtools", "developer tools", "task manager"}


def _get_exe_name(pid: int) -> str:
    """Получить имя исполняемого файла по PID."""
    try:
        handle = ctypes.windll.kernel32.OpenProcess(0x0410, False, pid)
        if handle:
            buf = ctypes.create_unicode_buffer(260)
            ctypes.windll.psapi.GetModuleFileNameExW(handle, None, buf, 260)
            ctypes.windll.kernel32.CloseHandle(handle)
            return os.path.basename(buf.value).lower()
    except Exception:
        pass
    return ""


class Win32WindowService(IWindowService):
    """
    Реализация сервиса работы с окнами через Win32 API.
    Single Responsibility: только работа с окнами ОС.
    """

    def scan_browser_windows(self, keywords: List[str]) -> List[WindowInfo]:
        """Найти ТОЛЬКО окна браузера.
        
        Приоритет определения:
        1. По имени процесса (exe) — самый надёжный
        2. По Win32 class name окна — для Chromium-based
        3. По ключевым словам — fallback для неизвестных браузеров
        """
        all_windows = self._get_all_visible_windows()
        browser_windows = []
        seen_hwnds = set()

        for win in all_windows:
            title_lower = win.title.lower().strip()

            # Исключаем служебные окна
            if any(excl in title_lower for excl in EXCLUDE_TITLES):
                continue
            if not title_lower:
                continue

            matched = False

            # Определяем exe процесса
            exe_name = _get_exe_name(win.pid)

            # Исключаем известные НЕ-браузеры (Electron-приложения)
            if exe_name and exe_name in EXCLUDED_EXE_NAMES:
                continue

            # Способ 1: по имени процесса (самый надёжный)
            if exe_name and exe_name in BROWSER_EXE_NAMES:
                matched = True

            # Способ 2: по ключевым словам в заголовке (fallback)
            if not matched and keywords:
                for keyword in keywords:
                    kw = keyword.lower().strip()
                    if kw and kw in title_lower:
                        matched = True
                        break

            if matched and win.hwnd not in seen_hwnds:
                seen_hwnds.add(win.hwnd)
                browser_windows.append(win)

        return browser_windows

    def get_foreground_window(self) -> Optional[WindowInfo]:
        """Получить текущее активное окно."""
        hwnd = win32gui.GetForegroundWindow()
        if hwnd and win32gui.IsWindowVisible(hwnd):
            return self.get_window_info(hwnd)
        return None

    def get_window_info(self, hwnd: int) -> Optional[WindowInfo]:
        """Получить информацию об окне по HWND."""
        if win32gui.IsWindow(hwnd) and win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            try:
                rect = win32gui.GetWindowRect(hwnd)
                x, y, x2, y2 = rect
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                return WindowInfo(
                    hwnd=hwnd, title=title,
                    x=x, y=y,
                    width=x2 - x, height=y2 - y,
                    pid=pid,
                )
            except Exception:
                pass
        return None

    def activate_window(self, hwnd: int) -> None:
        """Активировать окно (вывести на передний план)."""
        try:
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            try:
                current_thread = win32api.GetCurrentThreadId()
                target_thread, _ = win32process.GetWindowThreadProcessId(hwnd)
                if current_thread != target_thread:
                    ctypes.windll.user32.AttachThreadInput(current_thread, target_thread, True)
                    win32gui.SetForegroundWindow(hwnd)
                    ctypes.windll.user32.AttachThreadInput(current_thread, target_thread, False)
            except Exception:
                pass

    def absolute_to_relative(self, x: int, y: int, window: WindowInfo) -> Tuple[float, float]:
        """Абсолютные → относительные координаты (0.0–1.0)."""
        if window.width == 0 or window.height == 0:
            return (0.0, 0.0)
        rel_x = (x - window.x) / window.width
        rel_y = (y - window.y) / window.height
        return (rel_x, rel_y)

    def relative_to_absolute(self, rel_x: float, rel_y: float, window: WindowInfo) -> Tuple[int, int]:
        """Относительные → абсолютные координаты."""
        abs_x = int(window.x + rel_x * window.width)
        abs_y = int(window.y + rel_y * window.height)
        return (abs_x, abs_y)

    # ---- Приватные методы ----

    def _get_all_visible_windows(self) -> List[WindowInfo]:
        """Перечислить все видимые окна с минимальным размером."""
        windows = []

        def enum_callback(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title.strip():
                    try:
                        rect = win32gui.GetWindowRect(hwnd)
                        x, y, x2, y2 = rect
                        w, h = x2 - x, y2 - y
                        if w > 200 and h > 200:
                            _, pid = win32process.GetWindowThreadProcessId(hwnd)
                            windows.append(WindowInfo(
                                hwnd=hwnd, title=title,
                                x=x, y=y, width=w, height=h,
                                pid=pid,
                            ))
                    except Exception:
                        pass

        win32gui.EnumWindows(enum_callback, None)
        return windows
