# -*- coding: utf-8 -*-
"""
DEPRECATED: Этот модуль оставлен для обратной совместимости.
Используйте browser_sync.core.models.config и browser_sync.services.config_service.
"""
# Re-export из новых модулей
from browser_sync.core.models.config import SyncConfig  # noqa: F401
from browser_sync.services.config_service import ConfigService  # noqa: F401

# Для обратной совместимости: функция загрузки конфигурации
def load_config():
    """DEPRECATED: Используйте ConfigService().load()"""
    return SyncConfig.load()
