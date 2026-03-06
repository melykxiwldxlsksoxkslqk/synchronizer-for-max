# -*- coding: utf-8 -*-
"""
Утилиты для работы с окнами Windows.
Поиск окон браузера, получение позиции/размера, фокусировка.
"""

import ctypes
import ctypes.wintypes
import re
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

import win32gui
import win32con
import win32api
import win32process


# Известные процессы браузеров
BROWSER_EXE_NAMES = {
    "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe",
    "vivaldi.exe", "yandex.exe", "browser.exe", "chromium.exe",
    "mimic.exe", "multilogin.exe", "gologin.exe", "octo-browser.exe",
    "adspower.exe", "incogniton.exe", "dolphin.exe",
    "onlymonsterbrowser.exe",
}

# Заголовки, которые нужно исключить (служебные окна браузеров / наше приложение)
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


@dataclass
class WindowInfo:
    """Информация об окне."""
    hwnd: int
    title: str
    x: int
    y: int
    width: int
    height: int
    pid: int = 0

    @property
    def rect(self) -> Tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)

    def is_valid(self) -> bool:
        return win32gui.IsWindow(self.hwnd) and win32gui.IsWindowVisible(self.hwnd)

    def __repr__(self):
        return f"WindowInfo(hwnd={self.hwnd}, title='{self.title[:40]}...', pos=({self.x},{self.y}), size={self.width}x{self.height})"


def get_all_windows() -> List[WindowInfo]:
    """Получить список всех видимых окон."""
    windows = []

    def enum_callback(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title.strip():
                try:
                    rect = win32gui.GetWindowRect(hwnd)
                    x, y, x2, y2 = rect
                    w = x2 - x
                    h = y2 - y
                    if w > 200 and h > 200:  # Игнорируем слишком маленькие окна
                        _, pid = win32process.GetWindowThreadProcessId(hwnd)
                        windows.append(WindowInfo(
                            hwnd=hwnd,
                            title=title,
                            x=x, y=y,
                            width=w, height=h,
                            pid=pid
                        ))
                except Exception:
                    pass

    win32gui.EnumWindows(enum_callback, None)
    return windows


def find_browser_windows(keywords: List[str]) -> List[WindowInfo]:
    """
    Найти окна браузера:
    1. По имени процесса (chrome.exe, firefox.exe, и т.д.)
    2. По ключевым словам в заголовке
    Исключает служебные окна и окно самого BrowserSync.
    """
    all_windows = get_all_windows()
    browser_windows = []
    seen_hwnds = set()

    for win in all_windows:
        title_lower = win.title.lower().strip()

        # Пропускаем служебные окна и наше приложение
        if any(excl in title_lower for excl in EXCLUDE_TITLES):
            continue

        # Пропускаем пустые заголовки
        if not title_lower:
            continue

        matched = False

        # Способ 1: по имени процесса
        exe_name = _get_exe_name(win.pid)
        if exe_name in BROWSER_EXE_NAMES:
            matched = True

        # Способ 2: по ключевым словам в заголовке
        if not matched:
            for keyword in keywords:
                if keyword.lower() in title_lower:
                    matched = True
                    break

        if matched and win.hwnd not in seen_hwnds:
            seen_hwnds.add(win.hwnd)
            browser_windows.append(win)

    return browser_windows


def get_foreground_window() -> Optional[WindowInfo]:
    """Получить текущее активное окно."""
    hwnd = win32gui.GetForegroundWindow()
    if hwnd and win32gui.IsWindowVisible(hwnd):
        title = win32gui.GetWindowText(hwnd)
        try:
            rect = win32gui.GetWindowRect(hwnd)
            x, y, x2, y2 = rect
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            return WindowInfo(
                hwnd=hwnd,
                title=title,
                x=x, y=y,
                width=x2 - x, height=y2 - y,
                pid=pid
            )
        except Exception:
            pass
    return None


def get_window_info(hwnd: int) -> Optional[WindowInfo]:
    """Получить информацию об окне по HWND."""
    if win32gui.IsWindow(hwnd) and win32gui.IsWindowVisible(hwnd):
        title = win32gui.GetWindowText(hwnd)
        try:
            rect = win32gui.GetWindowRect(hwnd)
            x, y, x2, y2 = rect
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            return WindowInfo(
                hwnd=hwnd,
                title=title,
                x=x, y=y,
                width=x2 - x, height=y2 - y,
                pid=pid
            )
        except Exception:
            pass
    return None


def activate_window(hwnd: int):
    """Активировать (вывести на передний план) окно."""
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        # Альтернативный метод через AttachThreadInput
        try:
            current_thread = win32api.GetCurrentThreadId()
            target_thread, _ = win32process.GetWindowThreadProcessId(hwnd)
            if current_thread != target_thread:
                ctypes.windll.user32.AttachThreadInput(current_thread, target_thread, True)
                win32gui.SetForegroundWindow(hwnd)
                ctypes.windll.user32.AttachThreadInput(current_thread, target_thread, False)
        except Exception:
            pass


def absolute_to_relative(x: int, y: int, window: WindowInfo) -> Tuple[float, float]:
    """Преобразовать абсолютные координаты в относительные (0.0 — 1.0) относительно окна."""
    if window.width == 0 or window.height == 0:
        return (0.0, 0.0)
    rel_x = (x - window.x) / window.width
    rel_y = (y - window.y) / window.height
    return (rel_x, rel_y)


def relative_to_absolute(rel_x: float, rel_y: float, window: WindowInfo) -> Tuple[int, int]:
    """Преобразовать относительные координаты в абсолютные для целевого окна."""
    abs_x = int(window.x + rel_x * window.width)
    abs_y = int(window.y + rel_y * window.height)
    return (abs_x, abs_y)


def send_click_to_window(hwnd: int, x: int, y: int, button: str = "left", double: bool = False):
    """Отправить клик мыши в окно без активации (через PostMessage)."""
    import time as _time

    try:
        client_x, client_y = win32gui.ScreenToClient(hwnd, (x, y))
    except Exception:
        return

    # Защита от отрицательных координат (клик вне окна)
    if client_x < 0 or client_y < 0:
        return

    lparam = win32api.MAKELONG(client_x, client_y)

    if button == "left":
        down_msg = win32con.WM_LBUTTONDOWN
        up_msg = win32con.WM_LBUTTONUP
        wparam = win32con.MK_LBUTTON
    elif button == "right":
        down_msg = win32con.WM_RBUTTONDOWN
        up_msg = win32con.WM_RBUTTONUP
        wparam = win32con.MK_RBUTTON
    elif button == "middle":
        down_msg = win32con.WM_MBUTTONDOWN
        up_msg = win32con.WM_MBUTTONUP
        wparam = win32con.MK_MBUTTON
    else:
        return

    # Сначала двигаем курсор в точку клика (важно для многих браузеров)
    win32api.PostMessage(hwnd, win32con.WM_MOUSEMOVE, 0, lparam)
    _time.sleep(0.005)

    win32api.PostMessage(hwnd, down_msg, wparam, lparam)
    _time.sleep(0.01)  # Небольшая пауза между down/up для надёжности
    win32api.PostMessage(hwnd, up_msg, 0, lparam)

    if double:
        _time.sleep(0.01)
        win32api.PostMessage(hwnd, down_msg, wparam, lparam)
        _time.sleep(0.01)
        win32api.PostMessage(hwnd, up_msg, 0, lparam)


def send_key_to_window(hwnd: int, vk_code: int, scan_code: int = 0, is_extended: bool = False):
    """Отправить нажатие клавиши в окно через PostMessage (fallback)."""
    lparam_down = 1 | (scan_code << 16)
    lparam_up = 1 | (scan_code << 16) | (1 << 30) | (1 << 31)

    if is_extended:
        lparam_down |= (1 << 24)
        lparam_up |= (1 << 24)

    win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, vk_code, lparam_down)
    win32api.PostMessage(hwnd, win32con.WM_KEYUP, vk_code, lparam_up)


def send_char_to_window(hwnd: int, char: str):
    """Отправить символ в окно через WM_CHAR (fallback)."""
    for c in char:
        win32api.PostMessage(hwnd, win32con.WM_CHAR, ord(c), 0)


def send_real_click(screen_x: int, screen_y: int):
    """Выполнить реальный клик через SendInput (двигает курсор + click).
    Координаты — экранные. Работает с Chrome UI (адресная строка, поиск)."""
    import time as _time
    # Получаем размер экрана для нормализации
    sm_cx = ctypes.windll.user32.GetSystemMetrics(0)  # SM_CXSCREEN
    sm_cy = ctypes.windll.user32.GetSystemMetrics(1)  # SM_CYSCREEN
    # Нормализованные координаты (0..65535)
    norm_x = int(screen_x * 65535 / sm_cx)
    norm_y = int(screen_y * 65535 / sm_cy)

    # Структуры для мыши
    class _MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", ctypes.c_long),
            ("dy", ctypes.c_long),
            ("mouseData", ctypes.wintypes.DWORD),
            ("dwFlags", ctypes.wintypes.DWORD),
            ("time", ctypes.wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class _MINPUT(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("mi", _MOUSEINPUT)]
        _anonymous_ = ("u",)
        _fields_ = [("type", ctypes.wintypes.DWORD), ("u", _U)]

    _INPUT_MOUSE = 0
    _MOUSEEVENTF_MOVE = 0x0001
    _MOUSEEVENTF_ABSOLUTE = 0x8000
    _MOUSEEVENTF_LEFTDOWN = 0x0002
    _MOUSEEVENTF_LEFTUP = 0x0004

    extra = ctypes.pointer(ctypes.c_ulong(0))

    # Двигаем курсор
    move = _MINPUT()
    move.type = _INPUT_MOUSE
    move.mi.dx = norm_x
    move.mi.dy = norm_y
    move.mi.dwFlags = _MOUSEEVENTF_MOVE | _MOUSEEVENTF_ABSOLUTE
    move.mi.dwExtraInfo = extra
    ctypes.windll.user32.SendInput(1, ctypes.byref(move), ctypes.sizeof(move))
    _time.sleep(0.01)

    # Клик
    down = _MINPUT()
    down.type = _INPUT_MOUSE
    down.mi.dx = norm_x
    down.mi.dy = norm_y
    down.mi.dwFlags = _MOUSEEVENTF_LEFTDOWN | _MOUSEEVENTF_ABSOLUTE
    down.mi.dwExtraInfo = extra
    ctypes.windll.user32.SendInput(1, ctypes.byref(down), ctypes.sizeof(down))
    _time.sleep(0.01)

    up = _MINPUT()
    up.type = _INPUT_MOUSE
    up.mi.dx = norm_x
    up.mi.dy = norm_y
    up.mi.dwFlags = _MOUSEEVENTF_LEFTUP | _MOUSEEVENTF_ABSOLUTE
    up.mi.dwExtraInfo = extra
    ctypes.windll.user32.SendInput(1, ctypes.byref(up), ctypes.sizeof(up))


# ---- SendInput для реалистичного ввода (работает с Chrome) ----

class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.wintypes.WORD),
        ("wScan", ctypes.wintypes.WORD),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]

class _INPUT(ctypes.Structure):
    class _INPUT_UNION(ctypes.Union):
        _fields_ = [("ki", _KEYBDINPUT)]
    _anonymous_ = ("_input",)
    _fields_ = [
        ("type", ctypes.wintypes.DWORD),
        ("_input", _INPUT_UNION),
    ]

_INPUT_KEYBOARD = 1
_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_UNICODE = 0x0004
_KEYEVENTF_SCANCODE = 0x0008
_KEYEVENTF_EXTENDEDKEY = 0x0001


def _send_input_key(vk: int = 0, scan: int = 0, flags: int = 0):
    """Отправить одно событие клавиши через SendInput."""
    inp = _INPUT()
    inp.type = _INPUT_KEYBOARD
    inp.ki.wVk = vk
    inp.ki.wScan = scan
    inp.ki.dwFlags = flags
    inp.ki.time = 0
    inp.ki.dwExtraInfo = ctypes.pointer(ctypes.c_ulong(0))
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))


def send_input_char(char: str):
    """Отправить символ через SendInput (Unicode). Работает с Chrome."""
    for c in char:
        code = ord(c)
        # Key down
        _send_input_key(vk=0, scan=code, flags=_KEYEVENTF_UNICODE)
        # Key up
        _send_input_key(vk=0, scan=code, flags=_KEYEVENTF_UNICODE | _KEYEVENTF_KEYUP)


def send_input_vk(vk_code: int, is_extended: bool = False):
    """Отправить нажатие VK-клавиши через SendInput. Работает с Chrome."""
    scan = win32api.MapVirtualKey(vk_code, 0)
    flags_down = _KEYEVENTF_SCANCODE
    flags_up = _KEYEVENTF_SCANCODE | _KEYEVENTF_KEYUP
    if is_extended:
        flags_down |= _KEYEVENTF_EXTENDEDKEY
        flags_up |= _KEYEVENTF_EXTENDEDKEY
    _send_input_key(vk=vk_code, scan=scan, flags=flags_down)
    _send_input_key(vk=vk_code, scan=scan, flags=flags_up)


def focus_and_send_keys(hwnd: int, keys_func, master_hwnd: int = 0):
    """
    Кратковременно фокусирует окно, выполняет ввод через SendInput,
    и возвращает фокус обратно.
    
    keys_func — callable, вызывается когда окно в фокусе.
    master_hwnd — HWND мастер-окна для возврата фокуса.
    """
    import time as _time
    try:
        # Сохраняем текущее активное окно
        prev_fg = win32gui.GetForegroundWindow()

        # Активируем целевое окно
        activate_window(hwnd)
        _time.sleep(0.03)  # Даём окну время получить фокус

        # Выполняем ввод
        keys_func()

        _time.sleep(0.02)

        # Возвращаем фокус
        restore_to = master_hwnd if master_hwnd else prev_fg
        if restore_to and restore_to != hwnd:
            activate_window(restore_to)
    except Exception:
        # Если что-то пошло не так — пытаемся вернуть фокус
        if master_hwnd:
            try:
                activate_window(master_hwnd)
            except Exception:
                pass


def send_scroll_to_window(hwnd: int, x: int, y: int, delta: int):
    """Отправить скролл в окно."""
    # WM_MOUSEWHEEL: lparam = экранные координаты, wparam = HIWORD=delta, LOWORD=keys
    lparam = win32api.MAKELONG(x, y)
    # delta может быть отрицательным — нужно правильно упаковать в HIWORD
    wparam = (delta & 0xFFFF) << 16
    try:
        win32api.PostMessage(hwnd, win32con.WM_MOUSEWHEEL, wparam, lparam)
    except Exception:
        pass
