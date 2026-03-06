# -*- coding: utf-8 -*-
"""
Browser Sync — Синхронизатор действий для нескольких окон браузера.
Поддержка: Multilogin, любые Chromium-based браузеры.

Архитектура (OOP / Microservices):
├── core/              — Ядро: абстракции, модели, Event Bus
│   ├── interfaces/    — Контракты (абстрактные классы)
│   ├── models/        — Доменные модели (Action, WindowInfo, SyncConfig)
│   └── events/        — Событийная система (EventBus)
├── services/          — Микросервисы (бизнес-логика)
│   ├── input_service  — Захват ввода пользователя
│   ├── hotkey_service — Горячие клавиши
│   ├── state_sync_service — WebSocket state-sync сервер
│   └── config_service — Конфигурация
├── adapters/          — Реализации интерфейсов
│   └── win32/         — Windows API (окна, ввод)
├── presentation/      — GUI слой (Eel контроллер)
├── orchestrator.py    — Оркестратор (связывает сервисы)
└── di_container.py    — Dependency Injection
"""

__version__ = "3.0.0"
__author__ = "MaxProject"
