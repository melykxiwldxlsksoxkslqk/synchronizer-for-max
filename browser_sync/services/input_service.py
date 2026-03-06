# -*- coding: utf-8 -*-
"""
InputCaptureService — сервис захвата ввода пользователя.
Реализует IInputService. Перехватывает мышь и клавиатуру.

Клавиатура: используем модуль `keyboard` (совместим с HotkeyService).
Мышь: используем pynput.mouse (конфликтов нет).
pynput.keyboard НЕ используется — конфликтует с `keyboard` модулем.
"""

import time
import queue
import threading
import logging
from typing import Callable, Optional, Set

from pynput import mouse
import keyboard as kb_module

from browser_sync.core.interfaces.input_service import IInputService
from browser_sync.core.models.action import Action, ActionType
from browser_sync.core.models.config import SyncConfig
from browser_sync.core.events.event_bus import EventBus, EventType

logger = logging.getLogger("BrowserSync.InputService")


class InputCaptureService(IInputService):
    """
    Сервис захвата пользовательского ввода.
    SRP: только захват событий мыши и клавиатуры.
    Использует Event Bus для уведомлений.
    """

    def __init__(self, action_queue: queue.Queue, config: SyncConfig):
        self._action_queue = action_queue
        self._config = config
        self._event_bus = EventBus()

        self._is_running = False
        self._is_paused = False

        self._mouse_listener: Optional[mouse.Listener] = None
        # keyboard module хуки (вместо pynput.keyboard)
        self._kb_hook_registered = False
        self._kb_press_hook = None   # хук от kb_module.on_press()
        self._kb_release_hook = None  # хук от kb_module.on_release()

        self._capture_filter: Optional[Callable[[], bool]] = None
        self._hotkeys: Set[str] = set()

        # Двойной клик
        self._last_click_time = 0
        self._last_click_pos = (0, 0)
        self._double_click_threshold = 0.25
        self._pending_click: Optional[Action] = None
        self._click_timer: Optional[threading.Timer] = None

        # Throttle для mouse_move
        self._last_move_time = 0
        self._move_throttle = 0.033  # ~30fps

        # Отслеживание нажатых клавиш (для key_release)
        self._pressed_keys: Set[str] = set()

    # ---- IInputService ----

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def is_paused(self) -> bool:
        return self._is_paused

    def start(self) -> None:
        """Начать захват ввода."""
        if self._is_running:
            return
        self._is_running = True
        self._is_paused = False

        # Мышь — pynput (работает без конфликтов)
        self._mouse_listener = mouse.Listener(
            on_click=self._on_mouse_click,
            on_scroll=self._on_mouse_scroll,
            on_move=self._on_mouse_move,
        )
        self._mouse_listener.start()

        # Клавиатура — keyboard module (совместим с HotkeyService)
        self._kb_press_hook = kb_module.on_press(self._on_kb_event_press, suppress=False)
        self._kb_release_hook = kb_module.on_release(self._on_kb_event_release, suppress=False)
        self._kb_hook_registered = True
        logger.info("InputCaptureService запущен (keyboard module + pynput mouse)")

    def stop(self) -> None:
        """Остановить захват."""
        self._is_running = False
        if self._click_timer:
            self._click_timer.cancel()
            self._click_timer = None
        self._pending_click = None

        # Мышь
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None

        # Клавиатура — снимаем наши хуки (НЕ все, чтобы не сломать HotkeyService)
        if self._kb_hook_registered:
            try:
                if self._kb_press_hook is not None:
                    kb_module.unhook(self._kb_press_hook)
                    self._kb_press_hook = None
            except (KeyError, ValueError):
                pass
            try:
                if self._kb_release_hook is not None:
                    kb_module.unhook(self._kb_release_hook)
                    self._kb_release_hook = None
            except (KeyError, ValueError):
                pass
            self._kb_hook_registered = False

        self._pressed_keys.clear()
        logger.info("InputCaptureService остановлен")

    def pause(self) -> None:
        self._is_paused = True

    def resume(self) -> None:
        self._is_paused = False

    def set_hotkeys(self, hotkeys: Set[str]) -> None:
        self._hotkeys = {k.lower() for k in hotkeys}

    def set_capture_filter(self, filter_fn: Optional[Callable[[], bool]]) -> None:
        self._capture_filter = filter_fn

    # ---- Private ----

    def _should_process(self) -> bool:
        if not self._is_running or self._is_paused:
            return False
        if self._capture_filter and not self._capture_filter():
            return False
        return True

    def _emit_action(self, action: Action):
        """Поместить действие в очередь и уведомить через Event Bus."""
        try:
            self._action_queue.put_nowait(action)
            logger.debug(f"ACTION QUEUED: {action.action_type.value} key={action.key} char={action.key_char} qsize={self._action_queue.qsize()}")
        except queue.Full:
            logger.warning("ACTION QUEUE FULL — dropped action!")
        self._event_bus.emit(EventType.ACTION_CAPTURED, action, source="InputCaptureService")

    # ---- Mouse callbacks ----

    def _on_mouse_click(self, x: int, y: int, button: mouse.Button, pressed: bool):
        if not pressed or not self._should_process():
            return
        if self._config and not self._config.sync_mouse_clicks:
            return

        now = time.time()
        btn_name = button.name

        is_double = (
            now - self._last_click_time < self._double_click_threshold
            and abs(x - self._last_click_pos[0]) < 5
            and abs(y - self._last_click_pos[1]) < 5
        )
        self._last_click_time = now
        self._last_click_pos = (x, y)

        if is_double:
            if self._click_timer:
                self._click_timer.cancel()
                self._click_timer = None
            self._pending_click = None
            self._emit_action(Action(
                action_type=ActionType.MOUSE_DOUBLE_CLICK,
                timestamp=now, x=x, y=y, button=btn_name,
            ))
        else:
            if self._click_timer:
                self._click_timer.cancel()
            pending = Action(
                action_type=ActionType.MOUSE_CLICK,
                timestamp=now, x=x, y=y, button=btn_name,
            )
            self._pending_click = pending
            self._click_timer = threading.Timer(
                self._double_click_threshold, self._flush_pending_click,
            )
            self._click_timer.daemon = True
            self._click_timer.start()

    def _flush_pending_click(self):
        pending = self._pending_click
        self._pending_click = None
        self._click_timer = None
        if pending and self._is_running:
            self._emit_action(pending)

    def _on_mouse_move(self, x: int, y: int):
        if not self._should_process():
            return
        if self._config and not self._config.sync_mouse_move:
            return
        now = time.time()
        if now - self._last_move_time < self._move_throttle:
            return
        self._last_move_time = now
        self._emit_action(Action(
            action_type=ActionType.MOUSE_MOVE,
            timestamp=now, x=x, y=y,
        ))

    def _on_mouse_scroll(self, x: int, y: int, dx: int, dy: int):
        if not self._should_process():
            return
        if self._config and not self._config.sync_mouse_scroll:
            return
        self._emit_action(Action(
            action_type=ActionType.MOUSE_SCROLL,
            timestamp=time.time(),
            x=x, y=y, scroll_dx=dx, scroll_dy=dy,
        ))

    # ---- Keyboard callbacks (keyboard module) ----

    # Маппинг keyboard module имён → vk коды (для специальных клавиш)
    _KB_NAME_TO_VK = {
        'enter': 0x0D, 'tab': 0x09, 'space': 0x20,
        'backspace': 0x08, 'delete': 0x2E, 'escape': 0x1B,
        'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
        'home': 0x24, 'end': 0x23, 'page up': 0x21, 'page down': 0x22,
        'insert': 0x2D, 'caps lock': 0x14,
        'shift': 0xA0, 'left shift': 0xA0, 'right shift': 0xA1,
        'ctrl': 0xA2, 'left ctrl': 0xA2, 'right ctrl': 0xA3,
        'alt': 0xA4, 'left alt': 0xA4, 'right alt': 0xA5,
        'left windows': 0x5B, 'right windows': 0x5C,
    }
    for i in range(1, 13):
        _KB_NAME_TO_VK[f'f{i}'] = 0x6F + i  # F1=0x70 ... F12=0x7B

    def _on_kb_event_press(self, event):
        """Обработка нажатия клавиши (keyboard module)."""
        if not self._should_process():
            return
        if self._config and not self._config.sync_keyboard:
            return

        name = event.name  # 'a', 'enter', 'shift', etc.
        scan = event.scan_code if hasattr(event, 'scan_code') else None

        # Не захватывать горячие клавиши
        if name and name.lower() in self._hotkeys:
            return

        self._pressed_keys.add(name)

        # Определяем: это печатный символ или специальная клавиша?
        is_special = len(name) > 1  # 'a' → not special, 'enter' → special

        if not is_special:
            # Обычный печатный символ
            self._emit_action(Action(
                action_type=ActionType.KEY_TYPE,
                timestamp=time.time(),
                key=name,
                key_char=name,
                vk_code=self._KB_NAME_TO_VK.get(name.lower()),
                scan_code=scan,
                is_special=False,
            ))
        else:
            # Специальная клавиша
            vk = self._KB_NAME_TO_VK.get(name.lower())
            self._emit_action(Action(
                action_type=ActionType.KEY_PRESS,
                timestamp=time.time(),
                key=name.lower(),
                key_char=None,
                vk_code=vk,
                scan_code=scan,
                is_special=True,
            ))

    def _on_kb_event_release(self, event):
        """Обработка отпускания клавиши (keyboard module)."""
        name = event.name
        self._pressed_keys.discard(name)
        # KEY_RELEASE не используется в playback, но логируем для полноты
