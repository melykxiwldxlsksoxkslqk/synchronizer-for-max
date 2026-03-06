# 🔄 Browser Sync v3.0 — Синхронизатор браузеров (OOP Architecture)

Синхронизирует действия (клики, ввод текста, скролл) из одного **мастер-окна** браузера во все остальные открытые окна.

**Современный веб-интерфейс** с тёмной темой, анимациями и удобным управлением.

Идеально подходит для работы с **Multilogin**, **Mirroring Browser** и любыми Chromium-based браузерами.

---

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
pip install -r requirements.txt
```

### 2. Запуск

```bash
python main.py
```

Интерфейс автоматически откроется в Chrome/Edge или системном браузере.

### 3. Использование

1. Откройте несколько окон браузера
2. Нажмите **«🔍 Сканировать»** — программа найдёт все окна
3. Выберите **мастер-окно** (круглая кнопка ⚪) — это окно, в котором вы будете работать
4. Отметьте галочками **целевые окна** (☑) — туда будут копироваться действия
5. Нажмите **▶ СТАРТ** или клавишу **F6**
6. Работайте в мастер-окне — все действия повторяются в остальных окнах!

---

## 🧠 State Sync режим (Python + Global State)

Для синхронизации значений полей между вкладками/сессиями добавлен отдельный режим
на основе **WebSocket + state repository + localStorage/BroadcastChannel**.

### Запуск State Sync сервера

```bash
python run_state_sync.py
```

После запуска откройте:

```text
http://127.0.0.1:8000
```

### Проверка сценария

1. Откройте страницу в двух и более вкладках
2. Укажите одинаковый `Session ID`
3. Нажмите «Подключиться» в каждой вкладке
4. Введите значение в `Email/Username/Комментарий` в одной вкладке
5. Значение появится в том же поле во всех остальных вкладках

---

## ⌨ Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| **F6** | Старт / Стоп синхронизации |
| **F7** | Пауза / Возобновление |
| **F8** | Выход из программы |

---

## ⚙ Настройки

- **🖱 Клики мыши** — синхронизировать левый/правый/средний клик
- **📜 Скролл** — синхронизировать прокрутку колёсиком
- **⌨ Клавиатура** — синхронизировать ввод текста и нажатия клавиш
- **↗ Движение мыши** — синхронизировать перемещение курсора (по умолчанию выкл.)
- **📐 Относительные координаты** — пересчитывать координаты мыши относительно размера окна (рекомендуется, если окна разного размера)
- **Задержка (мс)** — задержка между воспроизведением действий

---

## 📂 Структура проекта (OOP Architecture)

```
maxproject/
├── main.py                          # Точка входа
├── run_state_sync.py                # Точка входа state-sync сервера
├── requirements.txt                 # Зависимости
├── config.json                      # Настройки
├── README.md
├── state_sync_demo/
│   └── web/                         # Демо-клиент для sync полей
│       ├── index.html
│       ├── style.css
│       └── app.js
└── browser_sync/
    ├── __init__.py                  # Пакет v3.0
    ├── orchestrator.py              # 🎯 Оркестратор (Mediator)
    ├── di_container.py              # 💉 DI Container (Composition Root)
    │
    ├── core/                        # 🏛 ЯДРО — абстракции и модели
    │   ├── interfaces/              # Контракты (Abstract Base Classes)
    │   │   ├── input_service.py     #   IInputService
    │   │   ├── playback_service.py  #   IPlaybackService
    │   │   ├── window_service.py    #   IWindowService
    │   │   ├── hotkey_service.py    #   IHotkeyService
    │   │   └── config_service.py    #   IConfigService
    │   ├── models/                  # Доменные модели (Value Objects, Entities)
    │   │   ├── action.py            #   Action + ActionType
    │   │   ├── window.py            #   WindowInfo
    │   │   └── config.py            #   SyncConfig
    │   └── events/                  # Событийная система
    │       └── event_bus.py         #   EventBus (Observer/Mediator)
    │
    ├── services/                    # ⚙ МИКРОСЕРВИСЫ — бизнес-логика
    │   ├── input_service.py         # InputCaptureService (мышь + клавиатура)
    │   ├── hotkey_service.py        # HotkeyService (горячие клавиши)
    │   ├── state_sync_service.py    # StateSyncService (сервер + диагностика)
    │   └── config_service.py        # ConfigService (конфигурация)
    │
    ├── adapters/                    # 🔌 АДАПТЕРЫ — реализации интерфейсов
    │   ├── win32/                   # Windows API
    │   │   ├── window_service.py    #   Win32WindowService
    │   │   └── input_sender.py      #   Win32InputSender
    │
    ├── presentation/                # 🖥 ПРЕДСТАВЛЕНИЕ — GUI
    │   └── gui_controller.py        # Eel Controller (тонкий адаптер)
    │
    ├── state_sync/                  # 🧠 state-sync архитектура
    │   ├── domain/                  # Domain models + contracts
    │   ├── application/             # Use-cases / services
    │   ├── infrastructure/          # Repo + WebSocket hub
    │   ├── presentation/            # WebSocket controller
    │   └── app.py                   # FastAPI app factory
    │
    └── web/                         # 🌐 Веб-интерфейс
        ├── index.html
        ├── style.css
        └── app.js
```

---

## 🔧 Как это работает

### Архитектура (OOP + Microservices)

Приложение построено по принципам **SOLID** с использованием паттернов:

| Паттерн | Где используется |
|---------|-----------------|
| **Dependency Inversion** | Все сервисы зависят от интерфейсов (`core/interfaces/`) |
| **Dependency Injection** | `DIContainer` собирает граф зависимостей |
| **Observer / Event Bus** | Микросервисы общаются через `EventBus` |
| **Strategy** | State-sync через WebSocket + extension bridge |
| **Mediator** | `SyncOrchestrator` координирует все сервисы |
| **Adapter** | `GUI Controller` адаптирует Eel ↔ Orchestrator |
| **Factory** | `DIContainer` создаёт сервисы с зависимостями |

### Поток данных

1. **InputCaptureService** — перехватывает мышь/клавиатуру → пишет `Action` в очередь
2. **StateSyncService** — принимает/публикует обновления состояния через WebSocket
3. **EventBus** — уведомляет GUI об изменениях (статус, статистика, логи)
4. **SyncOrchestrator** — координирует жизненный цикл

### Автоматический sync значений полей (real browser)

В основном режиме (через `main.py`) синхронизация состояния полей работает через
extension + state-sync сервер:

- extension подключается к комнате state-sync;
- изменения `input/textarea/select/contenteditable` в главной вкладке отправляются в room;
- обновления автоматически применяются в остальных вкладках той же комнаты.

---

## ⚠ Важно

- Запускать **от имени администратора** для корректной работы горячих клавиш
- Программа работает только на **Windows**
- Для антидетект-браузеров убедитесь, что в поле «Поиск окон» указаны правильные ключевые слова из заголовков окон

---

## 📋 Зависимости

- `eel` — веб-интерфейс (Python + HTML/CSS/JS)
- `pynput` — перехват мыши и клавиатуры
- `pywin32` — Windows API
- `keyboard` — глобальные горячие клавиши
- `fastapi` — state-sync API / WebSocket endpoint
- `uvicorn` — ASGI сервер для запуска state-sync режима
