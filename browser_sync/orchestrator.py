# -*- coding: utf-8 -*-
"""
SyncOrchestrator — главный оркестратор приложения.

В текущей конфигурации работает в state-sync режиме:
запускает встроенный websocket сервер и координирует lifecycle.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import List, Optional, Tuple

from browser_sync.core.events.event_bus import EventBus, EventType
from browser_sync.core.models.action import Action
from browser_sync.core.models.config import SyncConfig
from browser_sync.core.models.window import WindowInfo

from browser_sync.core.interfaces.config_service import IConfigService
from browser_sync.core.interfaces.hotkey_service import IHotkeyService
from browser_sync.core.interfaces.input_service import IInputService
from browser_sync.core.interfaces.playback_service import IPlaybackService
from browser_sync.core.interfaces.state_sync_service import IStateSyncService
from browser_sync.core.interfaces.window_service import IWindowService

logger = logging.getLogger("BrowserSync.Orchestrator")


class SyncOrchestrator:
    """
    Оркестратор синхронизации.
    Координирует сервисы и режимы работы приложения.
    """

    def __init__(
        self,
        config_service: IConfigService,
        window_service: IWindowService,
        hotkey_service: IHotkeyService,
        state_sync_service: IStateSyncService,
        input_service_factory=None,
        playback_service_factory=None,
    ):
        self._config_service = config_service
        self._window_service = window_service
        self._hotkey_service = hotkey_service
        self._state_sync_service = state_sync_service

        self._event_bus = EventBus()
        self._action_queue: queue.Queue = queue.Queue(maxsize=1000)
        self._config: SyncConfig = config_service.config

        self._input_service_factory = input_service_factory
        self._playback_service_factory = playback_service_factory
        self._input_service: Optional[IInputService] = None
        self._playback_service: Optional[IPlaybackService] = None

        self._is_syncing = False
        self._master_window: Optional[WindowInfo] = None
        self._target_windows: List[WindowInfo] = []

        # Legacy focus cache remains for backward compatibility in non-state mode.
        self._fg_hwnd_cache = 0
        self._fg_cache_time = 0.0
        self._fg_cache_ttl = 0.05

        self._state_sync_only = bool(getattr(self._config, "state_sync_only", True))
        self._state_sync_url: str = ""
        self._state_diag_thread: Optional[threading.Thread] = None
        self._state_diag_running = False
        self._state_diag_interval_sec = 3.0
        self._state_diag_last_snapshot: Optional[Tuple[int, int, int, int]] = None
        self._state_diag_last_mode: str = ""

        if self._config.enable_logging:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
            )

        self._create_services()
        self._subscribe_events()

    # ---- Initialization ----

    def _create_services(self):
        """Создать сервисы capture/playback в legacy режиме."""
        if self._state_sync_only:
            return

        if self._input_service_factory:
            self._input_service = self._input_service_factory(
                self._action_queue, self._config,
            )

        if self._playback_service_factory:
            self._playback_service = self._playback_service_factory(
                self._action_queue, self._config, self._window_service,
            )

        if self._input_service and self._playback_service:
            self._input_service.set_capture_filter(self._should_capture)

    def _subscribe_events(self):
        """Подписаться на события от сервисов."""
        if self._state_sync_only:
            return
        self._event_bus.subscribe(EventType.ACTION_CAPTURED, self._on_action_captured)
        self._event_bus.subscribe(EventType.ACTION_PLAYED, self._on_action_played)
        self._event_bus.subscribe(EventType.ACTION_ERROR, self._on_action_error)
        self._event_bus.subscribe(EventType.ALL_TARGETS_DEAD, self._on_all_targets_dead)

    # ---- Public API ----

    @property
    def config(self) -> SyncConfig:
        return self._config

    @property
    def config_service(self) -> IConfigService:
        return self._config_service

    @property
    def is_syncing(self) -> bool:
        return self._is_syncing

    @property
    def is_state_sync_mode(self) -> bool:
        return self._state_sync_only

    @property
    def state_sync_url(self) -> str:
        return self._state_sync_url

    @property
    def master_window(self) -> Optional[WindowInfo]:
        return self._master_window

    @property
    def target_windows(self) -> List[WindowInfo]:
        return self._target_windows

    @property
    def playback_service(self) -> Optional[IPlaybackService]:
        return self._playback_service

    @property
    def window_service(self) -> IWindowService:
        return self._window_service

    def scan_windows(self) -> List[WindowInfo]:
        """Сканировать окна браузера для UI."""
        windows = self._window_service.scan_browser_windows(
            self._config.browser_window_keywords,
        )
        logger.info(f"Найдено {len(windows)} окон")
        self._event_bus.emit(EventType.WINDOWS_SCANNED, windows, source="Orchestrator")
        return windows

    def set_master_window(self, window: WindowInfo):
        self._master_window = window
        if self._playback_service:
            self._playback_service.set_master(window)
        logger.info(f"Мастер: {window.title[:50]}")
        self._event_bus.emit(EventType.MASTER_CHANGED, window, source="Orchestrator")
        self._event_bus.emit(
            EventType.STATUS_CHANGED,
            f"Мастер: {window.title[:40]}",
            source="Orchestrator",
        )

    def set_target_windows(self, windows: List[WindowInfo]):
        if self._config.exclude_master and self._master_window:
            windows = [w for w in windows if w.hwnd != self._master_window.hwnd]
        self._target_windows = windows
        if self._playback_service:
            self._playback_service.set_targets(windows)
        logger.info(f"Цели: {len(windows)}")
        self._event_bus.emit(EventType.TARGETS_CHANGED, windows, source="Orchestrator")

    def auto_setup(self) -> bool:
        windows = self.scan_windows()
        if len(windows) < 2:
            self._event_bus.emit(
                EventType.STATUS_CHANGED,
                "⚠ Нужно минимум 2 окна!",
                source="Orchestrator",
            )
            return False
        self.set_master_window(windows[0])
        self.set_target_windows(windows[1:])
        return True

    def _start_state_sync_server(self) -> bool:
        self._state_sync_url = "chrome.storage.local"
        self._event_bus.emit(
            EventType.STATUS_CHANGED,
            "🟢 Storage Sync активен (chrome.storage.local)",
            source="Orchestrator",
        )
        self._event_bus.emit(
            EventType.LOG_MESSAGE,
            "Storage Sync: source of truth = chrome.storage.local, "
            "действия синхронизируются через extension action-bus. "
            "chrome:// страницы (Новая вкладка, Расширения) не поддерживаются.",
            source="Orchestrator",
        )
        return True

    def _emit_state_log(self, message: str) -> None:
        self._event_bus.emit(
            EventType.LOG_MESSAGE,
            f"🧠 {message}",
            source="StateSync",
        )

    def _start_state_diag_monitor(self) -> None:
        if self._state_diag_running:
            return
        self._state_diag_last_snapshot = None
        self._state_diag_last_mode = ""
        self._state_diag_running = True
        self._state_diag_thread = threading.Thread(
            target=self._state_diag_loop,
            daemon=True,
            name="StateSyncDiagMonitor",
        )
        self._state_diag_thread.start()

    def _stop_state_diag_monitor(self) -> None:
        self._state_diag_running = False
        if self._state_diag_thread:
            self._state_diag_thread.join(timeout=1.0)
            self._state_diag_thread = None

    def _state_diag_loop(self) -> None:
        while self._state_diag_running:
            try:
                diag = self._state_sync_service.get_diagnostics()
                active = int(diag.get("active_connections", 0))
                total = int(diag.get("total_connections", 0))
                msgs = int(diag.get("total_messages", 0))
                fields = int(diag.get("field_changes", 0))
                snapshot = (active, total, msgs, fields)
                if snapshot != self._state_diag_last_snapshot:
                    self._emit_state_log(
                        f"[DIAG] active={active} total={total} msgs={msgs} field_changes={fields}"
                    )
                    self._state_diag_last_snapshot = snapshot

                if active > 0:
                    mode = "ws_active"
                    message = f"[DIAG] ws-клиенты подключены: active={active}."
                elif total > 0:
                    mode = "ws_inactive"
                    message = "[DIAG] ws-клиенты временно неактивны (активных подключений нет)."
                else:
                    mode = "storage_only"
                    message = (
                        "[DIAG] ws-клиентов нет — это нормально для "
                        "BrowserSync State Bridge (storage-sync)."
                    )

                if mode != self._state_diag_last_mode:
                    self._emit_state_log(message)
                    self._state_diag_last_mode = mode
            except Exception as e:
                self._emit_state_log(f"[DIAG] monitor_error: {e}")
            time.sleep(self._state_diag_interval_sec)

    def start_sync(self):
        """Начать синхронизацию."""
        if self._is_syncing:
            return

        if self._state_sync_only:
            if not self._start_state_sync_server():
                return
            self._is_syncing = True
            self._event_bus.emit(EventType.SYNC_STARTED, source="Orchestrator")
            logger.info("✅ State Sync запущен")
            return

        if not self._master_window or not self._target_windows:
            logger.error("Не настроены окна!")
            return
        if not self._input_service or not self._playback_service:
            logger.error("Legacy сервисы не инициализированы")
            return

        self._is_syncing = True

        while not self._action_queue.empty():
            try:
                self._action_queue.get_nowait()
            except queue.Empty:
                break

        self._input_service.set_hotkeys(self._config.get_hotkeys_set())
        self._input_service.start()
        self._playback_service.start()
        self._event_bus.emit(EventType.SYNC_STARTED, source="Orchestrator")
        self._event_bus.emit(EventType.STATUS_CHANGED, "🟢 Синхронизация активна", source="Orchestrator")

    def stop_sync(self):
        """Остановить синхронизацию."""
        if not self._is_syncing:
            return

        self._is_syncing = False
        if self._state_sync_only:
            self._event_bus.emit(EventType.SYNC_STOPPED, source="Orchestrator")
            self._event_bus.emit(
                EventType.STATUS_CHANGED,
                "🔴 Storage Sync остановлен",
                source="Orchestrator",
            )
            logger.info("⛔ Storage Sync остановлен")
            return

        if self._input_service:
            self._input_service.stop()
        if self._playback_service:
            self._playback_service.stop()

        self._event_bus.emit(EventType.SYNC_STOPPED, source="Orchestrator")
        self._event_bus.emit(EventType.STATUS_CHANGED, "🔴 Синхронизация остановлена", source="Orchestrator")

    def toggle_sync(self):
        if self._is_syncing:
            self.stop_sync()
            return
        if self._state_sync_only:
            self.start_sync()
            return
        if not self._master_window or not self._target_windows:
            if not self.auto_setup():
                return
        self.start_sync()

    def pause_sync(self):
        """Пауза/возобновление."""
        if not self._is_syncing:
            return

        if self._state_sync_only:
            self._event_bus.emit(
                EventType.STATUS_CHANGED,
                "ℹ В state-sync режиме пауза не используется",
                source="Orchestrator",
            )
            return

        if not self._input_service or not self._playback_service:
            return
        if self._input_service.is_paused:
            self._input_service.resume()
            self._playback_service.resume()
            self._event_bus.emit(EventType.SYNC_RESUMED, source="Orchestrator")
            self._event_bus.emit(EventType.STATUS_CHANGED, "🟢 Синхронизация возобновлена", source="Orchestrator")
        else:
            self._input_service.pause()
            self._playback_service.pause()
            self._event_bus.emit(EventType.SYNC_PAUSED, source="Orchestrator")
            self._event_bus.emit(EventType.STATUS_CHANGED, "⏸ Пауза", source="Orchestrator")

    def register_hotkeys(self):
        self._hotkey_service.register(self._config.hotkey_toggle, self.toggle_sync)
        self._hotkey_service.register(self._config.hotkey_pause, self.pause_sync)
        self._hotkey_service.register(self._config.hotkey_exit, self.shutdown)
        logger.info(
            f"Hotkeys: Toggle={self._config.hotkey_toggle}, "
            f"Pause={self._config.hotkey_pause}, Exit={self._config.hotkey_exit}"
        )

    def upload_files(self, file_paths: list) -> dict:
        if self._state_sync_only:
            return {
                "success": False,
                "message": "В state-sync режиме загрузка файлов через playback отключена",
            }
        if not file_paths:
            return {"success": False, "message": "Нет файлов"}
        if not self._target_windows:
            return {"success": False, "message": "Нет целевых окон"}
        if not self._playback_service:
            return {"success": False, "message": "Playback недоступен"}

        success = self._playback_service.upload_files_to_targets(file_paths)
        total = len(self._target_windows)
        if success > 0:
            msg = f"✅ Файлы загружены в {success}/{total} окон"
            self._event_bus.emit(EventType.FILES_UPLOADED, {"success": success, "total": total}, source="Orchestrator")
            self._event_bus.emit(EventType.LOG_MESSAGE, f"📂 {msg}", source="Orchestrator")
            return {"success": True, "message": msg, "uploaded": success, "total": total}

        msg = f"⚠ Не удалось загрузить (0/{total})"
        self._event_bus.emit(EventType.FILES_UPLOAD_ERROR, msg, source="Orchestrator")
        return {"success": False, "message": msg}

    def shutdown(self):
        self.stop_sync()
        self._hotkey_service.unregister_all()
        self._event_bus.emit(EventType.APP_SHUTDOWN, source="Orchestrator")
        logger.info("Завершение работы")

    # ---- Private (legacy) ----

    def _should_capture(self) -> bool:
        if not self._master_window or not self._master_window.hwnd:
            return False
        if self._playback_service and hasattr(self._playback_service, "is_sending") and self._playback_service.is_sending:
            return False
        now = time.time()
        if now - self._fg_cache_time > self._fg_cache_ttl:
            try:
                import win32gui as _wg
                self._fg_hwnd_cache = _wg.GetForegroundWindow()
            except Exception:
                self._fg_hwnd_cache = 0
            self._fg_cache_time = now
        return self._fg_hwnd_cache != 0 and self._fg_hwnd_cache == self._master_window.hwnd

    # ---- Event Handlers (legacy) ----

    def _on_action_captured(self, event):
        action: Action = event.data
        if self._config.enable_logging:
            self._event_bus.emit(EventType.LOG_MESSAGE, action.describe(), source="Orchestrator")

    def _on_action_played(self, event):
        data = event.data
        errors = self._playback_service.errors_count if self._playback_service else 0
        self._event_bus.emit(
            EventType.STATS_UPDATED,
            {"actions": data["total"], "errors": errors},
            source="Orchestrator",
        )

    def _on_action_error(self, event):
        data = event.data
        logger.error(f"Ошибка в '{data['target'].title[:30]}': {data['error']}")

    def _on_all_targets_dead(self, event):
        logger.warning("Все целевые окна закрыты")
        self._is_syncing = False
        if self._input_service:
            self._input_service.stop()
        self._event_bus.emit(
            EventType.STATUS_CHANGED,
            "⚠ Все целевые окна закрыты",
            source="Orchestrator",
        )
        self._event_bus.emit(EventType.SYNC_STOPPED, source="Orchestrator")

