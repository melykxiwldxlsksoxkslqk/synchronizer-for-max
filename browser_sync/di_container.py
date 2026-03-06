# -*- coding: utf-8 -*-
"""
Dependency Injection Container — фабрика создания приложения.
Паттерн: Composition Root.
Здесь собираются все зависимости и создаётся граф объектов.
"""

from browser_sync.services.config_service import ConfigService
from browser_sync.services.hotkey_service import HotkeyService
from browser_sync.services.state_sync_service import StateSyncService

from browser_sync.adapters.win32.window_service import Win32WindowService

from browser_sync.orchestrator import SyncOrchestrator


class DIContainer:
    """
    Контейнер зависимостей.
    Создаёт и конфигурирует все сервисы.
    Паттерн: Factory / Service Locator.
    """

    def __init__(self):
        self._services = {}

    def build_orchestrator(self) -> SyncOrchestrator:
        """Собрать оркестратор со всеми зависимостями."""
        # Сервис конфигурации
        config_service = ConfigService()
        config_service.load()

        # Сервисы платформы (адаптеры)
        window_service = Win32WindowService()
        hotkey_service = HotkeyService()
        state_sync_service = StateSyncService()

        # Оркестратор
        orchestrator = SyncOrchestrator(
            config_service=config_service,
            window_service=window_service,
            hotkey_service=hotkey_service,
            state_sync_service=state_sync_service,
        )

        self._services["orchestrator"] = orchestrator
        self._services["config"] = config_service
        self._services["window"] = window_service
        self._services["hotkey"] = hotkey_service
        self._services["state_sync"] = state_sync_service

        return orchestrator

    def get_service(self, name: str):
        """Получить сервис по имени."""
        return self._services.get(name)
