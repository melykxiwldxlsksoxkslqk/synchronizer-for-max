# -*- coding: utf-8 -*-
"""
GUI Controller — слой представления (Eel backend).
Тонкий контроллер: делегирует всю работу оркестратору.
Паттерн: Adapter (адаптирует Eel ↔ Orchestrator).
"""

import sys
import os
import time
import threading
import logging
from collections import deque
from typing import List, Optional

import eel

from browser_sync.di_container import DIContainer
from browser_sync.orchestrator import SyncOrchestrator
from browser_sync.core.events.event_bus import EventBus, EventType
from browser_sync.core.models.window import WindowInfo

logger = logging.getLogger("BrowserSync.GUI")

# ---- Глобальные объекты ----
container: Optional[DIContainer] = None
orchestrator: Optional[SyncOrchestrator] = None
event_bus: Optional[EventBus] = None
found_windows: List[WindowInfo] = []
backend_log_queue = deque(maxlen=2000)
backend_log_lock = threading.Lock()


def _init():
    """Инициализация через DI Container."""
    global container, orchestrator, event_bus

    container = DIContainer()
    orchestrator = container.build_orchestrator()
    event_bus = EventBus()

    # Подписка на события для UI
    event_bus.subscribe(EventType.STATUS_CHANGED, _on_status_changed)
    event_bus.subscribe(EventType.LOG_MESSAGE, _on_log_message)
    event_bus.subscribe(EventType.STATS_UPDATED, _on_stats_updated)
    event_bus.subscribe(EventType.SYNC_STOPPED, _on_sync_stopped)

    # Горячие клавиши
    orchestrator.register_hotkeys()


# ---- Event Handlers (Python → JavaScript) ----

def _on_status_changed(event):
    try:
        eel.updateStatus(event.data)
    except Exception:
        pass


def _on_log_message(event):
    message = str(event.data)
    with backend_log_lock:
        backend_log_queue.append(message)


def _on_stats_updated(event):
    try:
        data = event.data
        eel.updateStats(data["actions"], data["errors"])
    except Exception:
        pass


def _on_sync_stopped(event):
    try:
        eel.onSyncStopped()
    except Exception:
        pass


@eel.expose
def pull_backend_logs() -> list:
    """Получить и очистить накопленные backend-логи."""
    with backend_log_lock:
        if not backend_log_queue:
            return []
        items = list(backend_log_queue)
        backend_log_queue.clear()
    return items


# ---- Eel-exposed functions (JavaScript → Python) ----

@eel.expose
def auto_start() -> dict:
    """Одна кнопка: запуск storage-sync режима."""
    global found_windows
    found_windows = orchestrator.scan_windows()

    orchestrator.start_sync()
    if not orchestrator.is_syncing:
        return {"success": False, "message": "Не удалось запустить storage-sync"}

    window_msg = (
        f"Окна найдены: {len(found_windows)}."
        if found_windows else
        "Окна не найдены через Win32-сканер, но storage-sync extension уже активен."
    )
    return {
        "success": True,
        "message": (
            f"{window_msg} "
            f"Режим: Storage Sync (chrome.storage.local)."
        ),
    }


@eel.expose
def auto_scan() -> dict:
    """Авто-скан окон."""
    global found_windows
    found_windows = orchestrator.scan_windows()
    master_hwnd = orchestrator.master_window.hwnd if orchestrator.master_window else 0
    return {
        "windows": [w.to_dict() for w in found_windows],
        "master_hwnd": master_hwnd,
    }


@eel.expose
def scan_windows(keywords_str: str = "") -> list:
    """Сканировать окна (legacy)."""
    global found_windows
    if keywords_str.strip():
        orchestrator.config.browser_window_keywords = [
            k.strip() for k in keywords_str.split(",") if k.strip()
        ]
    found_windows = orchestrator.scan_windows()
    return [w.to_dict() for w in found_windows]


@eel.expose
def set_master(idx: int):
    if 0 <= idx < len(found_windows):
        orchestrator.set_master_window(found_windows[idx])


@eel.expose
def set_targets(indices: list):
    targets = [found_windows[i] for i in indices if 0 <= i < len(found_windows)]
    orchestrator.set_target_windows(targets)


@eel.expose
def start_sync() -> dict:
    orchestrator.start_sync()
    if orchestrator.is_syncing:
        return {"success": True, "message": "Storage Sync активен: chrome.storage.local"}
    return {"success": False, "message": "Не удалось запустить синхронизацию"}


@eel.expose
def stop_sync():
    orchestrator.stop_sync()


@eel.expose
def pause_sync():
    orchestrator.pause_sync()


@eel.expose
def get_settings() -> dict:
    cfg = orchestrator.config
    return {
        "sync_mouse_clicks": cfg.sync_mouse_clicks,
        "sync_mouse_scroll": cfg.sync_mouse_scroll,
        "sync_keyboard": cfg.sync_keyboard,
        "sync_mouse_move": cfg.sync_mouse_move,
        "use_relative_coords": cfg.use_relative_coords,
        "action_delay": cfg.action_delay,
        "browser_window_keywords": cfg.browser_window_keywords,
    }


@eel.expose
def save_settings(settings: dict):
    cfg = orchestrator.config
    cfg.sync_mouse_clicks = settings.get("sync_clicks", True)
    cfg.sync_mouse_scroll = settings.get("sync_scroll", True)
    cfg.sync_keyboard = settings.get("sync_keyboard", True)
    cfg.sync_mouse_move = settings.get("sync_mouse_move", False)
    orchestrator.config_service.save(cfg)


@eel.expose
def get_sync_status() -> dict:
    return {
        "active_connections": 0,
        "total_connections": 0,
        "total_messages": 0,
        "field_changes": 0,
        "message": (
            "Storage-sync активен. source_of_truth=chrome.storage.local, "
            "mode=multi-action, action_bus_prefix=__bs_action_bus_v1__:*, "
            "note=chrome:// pages are not supported"
        ),
    }


@eel.expose
def save_keywords(keywords_str: str):
    if keywords_str.strip():
        orchestrator.config.browser_window_keywords = [
            k.strip() for k in keywords_str.split(",") if k.strip()
        ]
        orchestrator.config_service.save()


@eel.expose
def set_delay(ms: int):
    orchestrator.config.action_delay = ms / 1000.0
    orchestrator.config_service.save()


# ---- File Upload ----

@eel.expose
def select_upload_files() -> dict:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    file_paths = filedialog.askopenfilenames(
        title="Выберите файлы для загрузки",
        filetypes=[
            ("Изображения", "*.png *.jpg *.jpeg *.gif *.webp *.bmp *.svg"),
            ("Видео", "*.mp4 *.avi *.mov *.webm *.mkv"),
            ("Все файлы", "*.*"),
        ],
    )
    root.destroy()
    if file_paths:
        paths = [os.path.normpath(p) for p in file_paths]
        orchestrator.config.upload_file_paths = paths
        orchestrator.config_service.save()
        return {
            "success": True, "files": paths,
            "count": len(paths),
            "names": [os.path.basename(p) for p in paths],
        }
    return {"success": False, "files": [], "count": 0, "names": []}


@eel.expose
def set_upload_folder(folder_path: str) -> dict:
    if not folder_path or not os.path.isdir(folder_path):
        return {"success": False, "message": "Папка не найдена"}
    files = [
        os.path.normpath(os.path.join(folder_path, f))
        for f in sorted(os.listdir(folder_path))
        if os.path.isfile(os.path.join(folder_path, f))
    ]
    if not files:
        return {"success": False, "message": "Папка пуста"}
    orchestrator.config.upload_file_paths = files
    orchestrator.config_service.save()
    return {
        "success": True, "files": files,
        "count": len(files),
        "names": [os.path.basename(p) for p in files],
    }


@eel.expose
def select_upload_folder() -> dict:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    folder = filedialog.askdirectory(title="Выберите папку с файлами")
    root.destroy()
    if folder:
        return set_upload_folder(folder)
    return {"success": False, "files": [], "count": 0, "names": []}


@eel.expose
def do_upload_files() -> dict:
    paths = orchestrator.config.upload_file_paths
    if not paths:
        return {"success": False, "message": "Сначала выберите файлы!"}
    existing = [p for p in paths if os.path.exists(p)]
    if not existing:
        return {"success": False, "message": "Файлы не найдены на диске!"}
    return orchestrator.upload_files(existing)


@eel.expose
def get_upload_files() -> dict:
    paths = orchestrator.config.upload_file_paths
    return {
        "files": paths,
        "count": len(paths),
        "names": [os.path.basename(p) for p in paths],
    }


@eel.expose
def clear_upload_files():
    orchestrator.config.upload_file_paths = []
    orchestrator.config_service.save()


# ---- Lifecycle ----

def _on_close(page, sockets):
    if not sockets:
        orchestrator.shutdown()
        orchestrator.config_service.save()
        sys.exit(0)


# ---- Entry Point ----

def main():
    """Запустить GUI приложение."""
    _init()

    # Путь к web-файлам: presentation/ -> browser_sync/ -> web/
    web_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "web"))
    if not os.path.isdir(web_dir):
        # Fallback: ищем от корня проекта
        web_dir = os.path.normpath(
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "browser_sync", "web")
        )

    eel.init(web_dir)

    try:
        eel.start("index.html", size=(1100, 780), position=(100, 50),
                   port=0, close_callback=_on_close, mode="edge",
                   cmdline_args=["--disable-gpu"])
    except EnvironmentError:
        try:
            eel.start("index.html", size=(1100, 780), position=(100, 50),
                       port=0, close_callback=_on_close, mode="chrome",
                       cmdline_args=["--disable-gpu", "--disable-extensions"])
        except EnvironmentError:
            eel.start("index.html", size=(1100, 780), port=0,
                       close_callback=_on_close, mode=None)


if __name__ == "__main__":
    main()
