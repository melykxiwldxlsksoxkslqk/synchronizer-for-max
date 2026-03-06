# BrowserSync State Extension (TypeScript)

Расширение для синхронизации всех пользовательских действий между вкладками/окнами браузера.

## Структура

- `src/content-main.ts` — entry point контент-скрипта
- `src/content/` — модульные сервисы синхронизации
  - `types.ts` — все типы payload и envelope
  - `constants.ts` — ключи storage, таймауты
  - `bootstrap.ts` — инициализация
  - `utils/` — `dom-key`, `id`, `normalize-scope`
  - `services/` — `sync-engine`, `chrome-storage`, `logger`
  - `services/actions/` — по одному сервису на каждый тип действия
- `dist/` — собранные runtime-файлы для браузера

## Поддерживаемые события

| Сервис | События DOM | Throttle | Назначение |
|---|---|---|---|
| `InputActionService` | `input`, `change` | — | Текстовый ввод, чекбоксы, select |
| `ClickActionService` | `click` | — | Клики (с mousedown/mouseup в apply) |
| `MouseDownActionService` | `mousedown` | — | Нажатие кнопки мыши |
| `MouseUpActionService` | `mouseup` | — | Отжатие кнопки мыши |
| `MouseOverActionService` | `mouseover` | — | Наведение на элемент |
| `MouseOutActionService` | `mouseout` | — | Увод курсора с элемента |
| `MouseMoveActionService` | `mousemove` | 50ms | Движение курсора мыши |
| `DblClickActionService` | `dblclick` | — | Двойной клик |
| `ContextMenuActionService` | `contextmenu` | — | Правый клик |
| `FocusActionService` | `focus`, `blur` | — | Фокус/расфокус элементов |
| `SubmitActionService` | `submit` | — | Отправка форм |
| `KeyboardActionService` | `keydown`, `keyup`, `keypress` | — | Клавиатурные действия (включая Enter-сценарии) |
| `SelectActionService` | `select` | — | Выделение текста в полях |
| `ScrollActionService` | `scroll` | 250ms | Скролл страницы |
| `ClipboardActionService` | `copy`, `cut`, `paste` | — | Буфер обмена |
| `TouchActionService` | `touchstart`, `touchend` | — | Тач-события (мобильные) |
| `DragActionService` | `dragstart`, `dragend`, `drop` | — | Drag & Drop |
| `WheelActionService` | `wheel` | 200ms | Колесо мыши |

## Сборка

```bash
cd browser_sync/extension
npm install
npm run build
```

## Установка (Chrome/Edge)

1. Открой `chrome://extensions` (или `edge://extensions`)
2. Включи **Developer mode**
3. Нажми **Load unpacked**
4. Выбери папку `browser_sync/extension`

## Архитектура sync-движка

- Content script инжектится на все страницы и слушает только зарегистрированные в реестре сервисов события.
- Режим только storage-sync: без внешнего websocket-сервера и background-моста.
- Каждое действие упаковывается в `BrowserActionEnvelope` (sessionId, actionId, sourceApplicationId, sourceKind, payload)
  и пишется в `chrome.storage.local` отдельным ключом action-bus.
- Другие вкладки подписаны на `chrome.storage.onChanged` и применяют action, если:
  - совпадает `sessionId`,
  - `sourceApplicationId` отличается от текущей вкладки,
  - `sourceKind === "user"`.

### Защита от циклов (4 уровня)

1. `event.isTrusted` — собираем только реальные пользовательские ивенты
2. `inProgressApplyCount` — блокирует capture во время apply чужого action
3. `muteUntilByFieldKey` — краткий mute по ключу после apply (предотвращает обратную отправку)
4. `seenActionIds` — дедупликация по actionId (TTL 120с)

### Throttle для шумных событий

Сервисы scroll и wheel имеют `throttleMs` — sync-engine пропускает события чаще порога. Любой новый сервис может объявить `throttleMs` в интерфейсе.

## Логирование и диагностика

- Логи выводятся в консоль вкладки (DevTools) с форматом:
  `ISO_TIME + PREFIX + LEVEL + message + json-meta`.
- Базовый префикс: `BS-EXT`, движок: `BS-EXT:engine`, apply по типу: `BS-EXT:engine:action:<actionType>`.
- Логируются все этапы пайплайна:
  - bootstrap и регистрация сервисов;
  - capture событий и причины skip (`disabled`, `untrusted`, `in-progress`, `throttled`, `muted`, `no-payload`);
  - publish в `chrome.storage` (с ключом action-bus);
  - receive из `chrome.storage.onChanged` и фильтры (`wrong-session`, `self`, `non-user`, `duplicate`, `unsupported`);
  - apply и ошибки apply;
  - периодический snapshot метрик (каждые ~20 секунд) + финальный snapshot при остановке.
- Для снижения шума часть debug-логов идёт в sampling-режиме:
  первые N сообщений и далее каждое M-е.

## Настройки сессии

Источник истины — `chrome.storage.local`.

- `__bs_sync_config_v1__` → `{ enabled: boolean, sessionId: string }`
- `__bs_action_bus_v1__:*` → action envelope-элементы (шина событий, append-only с TTL cleanup)
