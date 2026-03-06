# -*- coding: utf-8 -*-
"""
ConfigService — сервис управления конфигурацией.
Реализует IConfigService.
"""

import logging
from typing import Optional

from browser_sync.core.interfaces.config_service import IConfigService
from browser_sync.core.models.config import SyncConfig
from browser_sync.core.events.event_bus import EventBus, EventType

logger = logging.getLogger("BrowserSync.ConfigService")


class ConfigService(IConfigService):
    """
    Сервис конфигурации.
    SRP: загрузка, сохранение и предоставление конфигурации.
    """

    def __init__(self):
        self._config: Optional[SyncConfig] = None
        self._event_bus = EventBus()

    @property
    def config(self) -> SyncConfig:
        if self._config is None:
            self._config = self.load()
        return self._config

    def load(self) -> SyncConfig:
        """Загрузить конфигурацию из файла."""
        self._config = SyncConfig.load()
        logger.info("Конфигурация загружена")
        return self._config

    def save(self, config: SyncConfig = None) -> None:
        """Сохранить конфигурацию."""
        if config:
            self._config = config
        if self._config:
            self._config.save()
            self._event_bus.emit(EventType.CONFIG_SAVED, self._config,
                                 source="ConfigService")
            logger.info("Конфигурация сохранена")

    def update(self, **kwargs) -> SyncConfig:
        """Обновить отдельные поля конфигурации."""
        cfg = self.config
        for key, value in kwargs.items():
            if hasattr(cfg, key):
                setattr(cfg, key, value)
        self._event_bus.emit(EventType.CONFIG_CHANGED, cfg, source="ConfigService")
        return cfg
