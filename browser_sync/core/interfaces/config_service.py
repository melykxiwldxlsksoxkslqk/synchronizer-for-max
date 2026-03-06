# -*- coding: utf-8 -*-
"""
Интерфейс: IConfigService — контракт сервиса конфигурации.
"""

from abc import ABC, abstractmethod
from typing import Optional

from browser_sync.core.models.config import SyncConfig


class IConfigService(ABC):
    """Контракт сервиса управления конфигурацией."""

    @abstractmethod
    def load(self) -> SyncConfig:
        """Загрузить конфигурацию."""
        ...

    @abstractmethod
    def save(self, config: Optional[SyncConfig] = None) -> None:
        """Сохранить конфигурацию. Если config=None, сохраняет текущую."""
        ...

    @abstractmethod
    def update(self, **kwargs) -> SyncConfig:
        """Обновить отдельные поля конфигурации."""
        ...

    @property
    @abstractmethod
    def config(self) -> SyncConfig:
        """Текущая конфигурация."""
        ...
