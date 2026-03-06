# -*- coding: utf-8 -*-
"""
Интерфейс: IPlaybackService — контракт сервиса воспроизведения.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from browser_sync.core.models.action import Action
from browser_sync.core.models.window import WindowInfo


class IPlaybackService(ABC):
    """Контракт сервиса воспроизведения действий."""

    @abstractmethod
    def start(self) -> None:
        """Начать воспроизведение из очереди."""
        ...

    @abstractmethod
    def stop(self) -> None:
        """Остановить воспроизведение."""
        ...

    @abstractmethod
    def pause(self) -> None:
        """Пауза."""
        ...

    @abstractmethod
    def resume(self) -> None:
        """Возобновление."""
        ...

    @abstractmethod
    def set_master(self, window: WindowInfo) -> None:
        """Установить мастер-окно."""
        ...

    @abstractmethod
    def set_targets(self, windows: List[WindowInfo]) -> None:
        """Установить целевые окна."""
        ...

    @abstractmethod
    def upload_files_to_targets(self, file_paths: List[str]) -> int:
        """Загрузить файлы во все целевые окна. Возвращает кол-во успешных."""
        ...

    @property
    @abstractmethod
    def actions_played(self) -> int:
        ...

    @property
    @abstractmethod
    def errors_count(self) -> int:
        ...
