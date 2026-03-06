# -*- coding: utf-8 -*-
"""
Browser Sync v3.0 — Синхронизатор действий для нескольких окон браузера.
Архитектура: OOP + Microservices + Event Bus + DI Container.
Точка входа: python main.py
"""

import sys
import os
import ctypes

# Проверка Windows
if sys.platform != "win32":
    print("❌ Эта программа работает только на Windows!")
    sys.exit(1)

# Рекомендация запуска от имени администратора
try:
    if not ctypes.windll.shell32.IsUserAnAdmin():
        print("⚠ Рекомендуется запуск от имени администратора.")
except Exception:
    pass

# Добавляем путь проекта
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("BrowserSync v3.0 (OOP Architecture) - Запуск...")
print("Интерфейс откроется в браузере")
print("Горячие клавиши: F6=Старт/Стоп, F7=Пауза, F8=Выход")
print()

from browser_sync.presentation.gui_controller import main

if __name__ == "__main__":
    main()
