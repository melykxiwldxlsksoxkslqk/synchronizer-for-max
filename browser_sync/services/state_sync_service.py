# -*- coding: utf-8 -*-
"""
StateSyncService — управление встроенным websocket сервером state-sync.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional

import uvicorn

from browser_sync.core.interfaces.state_sync_service import IStateSyncService
from browser_sync.state_sync.app import create_app


class StateSyncService(IStateSyncService):
    """
    Запускает FastAPI websocket сервер в фоне и управляет его lifecycle.
    """

    def __init__(self):
        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None
        self._host: str = "127.0.0.1"
        self._port: int = 8000
        self._log_callback: Optional[Callable[[str], None]] = None
        self._diag_lock = threading.Lock()
        self._diag_active_connections = 0
        self._diag_total_connections = 0
        self._diag_total_messages = 0
        self._diag_field_changes = 0
        self._diag_last_event_ts = 0.0

    def _log(self, message: str) -> None:
        self._update_diagnostics_from_message(message)
        if not self._log_callback:
            return
        try:
            self._log_callback(message)
        except Exception:
            pass

    def _reset_diagnostics(self) -> None:
        with self._diag_lock:
            self._diag_active_connections = 0
            self._diag_total_connections = 0
            self._diag_total_messages = 0
            self._diag_field_changes = 0
            self._diag_last_event_ts = 0.0

    def _update_diagnostics_from_message(self, message: str) -> None:
        with self._diag_lock:
            if "[WS] connect " in message:
                self._diag_active_connections += 1
                self._diag_total_connections += 1
            if "[WS] disconnect " in message or "[WS] disconnect_event " in message:
                self._diag_active_connections = max(0, self._diag_active_connections - 1)
            if message.startswith("[MSG] "):
                self._diag_total_messages += 1
            if "[MSG] field_changed " in message:
                self._diag_field_changes += 1
            if message.startswith("[WS]") or message.startswith("[MSG]") or message.startswith("[EXT:"):
                self._diag_last_event_ts = time.time()

    def get_diagnostics(self) -> dict:
        with self._diag_lock:
            return {
                "is_running": self.is_running,
                "host": self._host,
                "port": self._port,
                "active_connections": self._diag_active_connections,
                "total_connections": self._diag_total_connections,
                "total_messages": self._diag_total_messages,
                "field_changes": self._diag_field_changes,
                "last_event_ts": self._diag_last_event_ts,
            }

    @property
    def is_running(self) -> bool:
        return bool(self._server and getattr(self._server, "started", False))

    def start(
        self,
        host: str,
        port: int,
        log_callback: Optional[Callable[[str], None]] = None,
    ) -> bool:
        self._log_callback = log_callback
        if self.is_running:
            self._log(f"[SERVER] already running on {self._host}:{self._port}")
            return True

        self._host = host
        self._port = port
        self._reset_diagnostics()

        self._log(f"[SERVER] starting on {host}:{port}")
        app = create_app(debug_logger=self._log)
        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)

        self._thread = threading.Thread(
            target=self._server.run,
            daemon=True,
            name="StateSyncServerThread",
        )
        self._thread.start()

        # Wait until server starts or timeout.
        started = False
        for _ in range(40):
            if self.is_running:
                started = True
                break
            time.sleep(0.05)
        if started:
            self._log(f"[SERVER] started on {host}:{port}")
        else:
            self._log(f"[SERVER] failed to start on {host}:{port}")
        return started

    def stop(self) -> None:
        if not self._server:
            return

        self._log(f"[SERVER] stopping {self._host}:{self._port}")
        self._server.should_exit = True
        if self._thread:
            self._thread.join(timeout=2.0)
        self._server = None
        self._thread = None
        self._log("[SERVER] stopped")

    def build_room_ws_url(self, room_id: str, host: str, port: int) -> str:
        room = (room_id or "default-room").strip() or "default-room"
        return f"ws://{host}:{port}/ws/{room}"

