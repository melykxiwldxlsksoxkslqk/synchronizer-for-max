# -*- coding: utf-8 -*-
"""
Event Bus — система событий для слабой связи между микросервисами.
Паттерн: Observer / Mediator.

Микросервисы общаются через события, а не напрямую.
Это обеспечивает Low Coupling и High Cohesion.
"""

import logging
import threading
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("BrowserSync.EventBus")


class EventType(Enum):
    """Типы событий в системе."""
    # Жизненный цикл синхронизации
    SYNC_STARTED = auto()
    SYNC_STOPPED = auto()
    SYNC_PAUSED = auto()
    SYNC_RESUMED = auto()
    SYNC_TOGGLED = auto()

    # Действия пользователя
    ACTION_CAPTURED = auto()
    ACTION_PLAYED = auto()
    ACTION_ERROR = auto()

    # Окна
    WINDOWS_SCANNED = auto()
    MASTER_CHANGED = auto()
    TARGETS_CHANGED = auto()
    ALL_TARGETS_DEAD = auto()
    WINDOW_ADDED = auto()
    WINDOW_REMOVED = auto()

    # Конфигурация
    CONFIG_CHANGED = auto()
    CONFIG_SAVED = auto()

    # Статистика
    STATS_UPDATED = auto()

    # GUI
    STATUS_CHANGED = auto()
    LOG_MESSAGE = auto()

    # Загрузка файлов
    FILES_UPLOADED = auto()
    FILES_UPLOAD_ERROR = auto()

    # Приложение
    APP_SHUTDOWN = auto()


@dataclass
class Event:
    """
    Объект события.
    Несёт тип события и произвольные данные.
    """
    event_type: EventType
    data: Any = None
    source: str = ""

    def __repr__(self):
        return f"Event({self.event_type.name}, source={self.source})"


class EventBus:
    """
    Центральная шина событий.
    Singleton — одна шина на всё приложение.

    Поддерживает:
    - Подписку на конкретный тип события
    - Подписку на все события
    - Потокобезопасную доставку
    """

    _instance: Optional["EventBus"] = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._subscribers: Dict[EventType, List[Callable[[Event], None]]] = {}
        self._global_subscribers: List[Callable[[Event], None]] = []
        self._sub_lock = threading.Lock()

    def subscribe(self, event_type: EventType, handler: Callable[[Event], None]):
        """Подписаться на конкретный тип события."""
        with self._sub_lock:
            if event_type not in self._subscribers:
                self._subscribers[event_type] = []
            if handler not in self._subscribers[event_type]:
                self._subscribers[event_type].append(handler)

    def subscribe_all(self, handler: Callable[[Event], None]):
        """Подписаться на все события."""
        with self._sub_lock:
            if handler not in self._global_subscribers:
                self._global_subscribers.append(handler)

    def unsubscribe(self, event_type: EventType, handler: Callable[[Event], None]):
        """Отписаться от события."""
        with self._sub_lock:
            if event_type in self._subscribers:
                try:
                    self._subscribers[event_type].remove(handler)
                except ValueError:
                    pass

    def unsubscribe_all(self, handler: Callable[[Event], None]):
        """Отписать обработчик от всех событий."""
        with self._sub_lock:
            try:
                self._global_subscribers.remove(handler)
            except ValueError:
                pass
            for handlers in self._subscribers.values():
                try:
                    handlers.remove(handler)
                except ValueError:
                    pass

    def emit(self, event_type: EventType, data: Any = None, source: str = ""):
        """
        Опубликовать событие.
        Все подписчики вызываются синхронно в текущем потоке.
        """
        event = Event(event_type=event_type, data=data, source=source)

        with self._sub_lock:
            handlers = list(self._subscribers.get(event_type, []))
            global_handlers = list(self._global_subscribers)

        for handler in handlers + global_handlers:
            try:
                handler(event)
            except Exception as e:
                logger.error(f"Ошибка в обработчике {handler.__name__} для {event}: {e}")

    def clear(self):
        """Очистить все подписки (для тестов)."""
        with self._sub_lock:
            self._subscribers.clear()
            self._global_subscribers.clear()

    @classmethod
    def reset(cls):
        """Сбросить singleton (для тестов)."""
        with cls._lock:
            if cls._instance:
                cls._instance.clear()
                cls._instance._initialized = False
            cls._instance = None
