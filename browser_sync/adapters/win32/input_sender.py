# -*- coding: utf-8 -*-
"""
Win32InputSender — низкоуровневые операции отправки ввода через Win32 API.
Используется для отправки ввода в окна браузера через Win32.
"""

import ctypes
import ctypes.wintypes
import time
import logging

import win32gui
import win32con
import win32api
import win32process

logger = logging.getLogger("BrowserSync.Win32Input")

# ---- Структуры SendInput ----

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


class Win32InputSender:
    """
    Инкапсулирует все Win32 API методы отправки ввода.
    SRP: только низкоуровневая отправка мыши/клавиатуры.
    """

    @staticmethod
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

    @staticmethod
    def send_char(char: str):
        """Отправить символ через SendInput (Unicode)."""
        for c in char:
            code = ord(c)
            Win32InputSender._send_input_key(vk=0, scan=code, flags=_KEYEVENTF_UNICODE)
            Win32InputSender._send_input_key(vk=0, scan=code, flags=_KEYEVENTF_UNICODE | _KEYEVENTF_KEYUP)

    @staticmethod
    def send_vk(vk_code: int, is_extended: bool = False):
        """Отправить нажатие VK через SendInput."""
        scan = win32api.MapVirtualKey(vk_code, 0)
        flags_down = _KEYEVENTF_SCANCODE
        flags_up = _KEYEVENTF_SCANCODE | _KEYEVENTF_KEYUP
        if is_extended:
            flags_down |= _KEYEVENTF_EXTENDEDKEY
            flags_up |= _KEYEVENTF_EXTENDEDKEY
        Win32InputSender._send_input_key(vk=vk_code, scan=scan, flags=flags_down)
        Win32InputSender._send_input_key(vk=vk_code, scan=scan, flags=flags_up)

    @staticmethod
    def send_click_to_window(hwnd: int, x: int, y: int, button: str = "left",
                              double: bool = False):
        """Отправить клик через PostMessage (без активации)."""
        try:
            client_x, client_y = win32gui.ScreenToClient(hwnd, (x, y))
        except Exception:
            return

        if client_x < 0 or client_y < 0:
            return

        lparam = win32api.MAKELONG(client_x, client_y)

        if button == "left":
            down_msg, up_msg, wparam = win32con.WM_LBUTTONDOWN, win32con.WM_LBUTTONUP, win32con.MK_LBUTTON
        elif button == "right":
            down_msg, up_msg, wparam = win32con.WM_RBUTTONDOWN, win32con.WM_RBUTTONUP, win32con.MK_RBUTTON
        elif button == "middle":
            down_msg, up_msg, wparam = win32con.WM_MBUTTONDOWN, win32con.WM_MBUTTONUP, win32con.MK_MBUTTON
        else:
            return

        win32api.PostMessage(hwnd, win32con.WM_MOUSEMOVE, 0, lparam)
        time.sleep(0.005)
        win32api.PostMessage(hwnd, down_msg, wparam, lparam)
        time.sleep(0.01)
        win32api.PostMessage(hwnd, up_msg, 0, lparam)

        if double:
            time.sleep(0.01)
            win32api.PostMessage(hwnd, down_msg, wparam, lparam)
            time.sleep(0.01)
            win32api.PostMessage(hwnd, up_msg, 0, lparam)

    @staticmethod
    def send_scroll_to_window(hwnd: int, x: int, y: int, delta: int):
        """Отправить скролл через PostMessage."""
        lparam = win32api.MAKELONG(x, y)
        wparam = (delta & 0xFFFF) << 16
        try:
            win32api.PostMessage(hwnd, win32con.WM_MOUSEWHEEL, wparam, lparam)
        except Exception:
            pass

    @staticmethod
    def send_mouse_move_to_window(hwnd: int, abs_x: int, abs_y: int):
        """Отправить движение мыши через PostMessage."""
        try:
            cx, cy = win32gui.ScreenToClient(hwnd, (abs_x, abs_y))
            if cx < 0 or cy < 0:
                return
            lparam = win32api.MAKELONG(cx, cy)
            win32api.PostMessage(hwnd, win32con.WM_MOUSEMOVE, 0, lparam)
        except Exception:
            pass

    @staticmethod
    def focus_and_send_keys(hwnd: int, keys_func, master_hwnd: int = 0):
        """
        Кратковременно фокусирует окно, выполняет ввод,
        и возвращает фокус.
        """
        try:
            prev_fg = win32gui.GetForegroundWindow()

            # Активация
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

            time.sleep(0.02)
            keys_func()
            time.sleep(0.01)

            # Возвращаем фокус
            restore_to = master_hwnd if master_hwnd else prev_fg
            if restore_to and restore_to != hwnd:
                try:
                    if win32gui.IsIconic(restore_to):
                        win32gui.ShowWindow(restore_to, win32con.SW_RESTORE)
                    win32gui.SetForegroundWindow(restore_to)
                except Exception:
                    pass
        except Exception:
            if master_hwnd:
                try:
                    win32gui.SetForegroundWindow(master_hwnd)
                except Exception:
                    pass

    @staticmethod
    def post_char(hwnd: int, char: str):
        """
        Отправить символ через WM_CHAR (PostMessage).
        НЕ требует фокуса — окно может быть в фоне!
        """
        for c in char:
            code = ord(c)
            try:
                win32api.PostMessage(hwnd, win32con.WM_CHAR, code, 0)
            except Exception as e:
                logger.warning(f"post_char failed: {e}")

    @staticmethod
    def post_key(hwnd: int, vk_code: int, is_extended: bool = False):
        """
        Отправить нажатие+отпускание клавиши через WM_KEYDOWN/WM_KEYUP (PostMessage).
        НЕ требует фокуса.
        """
        scan = win32api.MapVirtualKey(vk_code, 0)
        # lparam для WM_KEYDOWN: repeat=1, scan_code, extended, context=0, previous=0, transition=0
        lparam_down = (1) | (scan << 16)
        if is_extended:
            lparam_down |= (1 << 24)
        # lparam для WM_KEYUP: repeat=1, scan_code, extended, context=0, previous=1, transition=1
        lparam_up = (1) | (scan << 16) | (1 << 30) | (1 << 31)
        if is_extended:
            lparam_up |= (1 << 24)
        try:
            win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, vk_code, lparam_down)
            time.sleep(0.005)
            win32api.PostMessage(hwnd, win32con.WM_KEYUP, vk_code, lparam_up)
        except Exception as e:
            logger.warning(f"post_key failed (vk=0x{vk_code:02X}): {e}")

    @staticmethod
    def screen_to_client(hwnd: int, x: int, y: int) -> tuple:
        """Экранные → клиентские координаты."""
        try:
            cx, cy = win32gui.ScreenToClient(hwnd, (x, y))
            return max(0, cx), max(0, cy)
        except Exception:
            return -1, -1
