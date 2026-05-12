# TouchSpace PWA и desktop notifications

## Что реализовано

Для внутренних ролей `admin`, `manager`, `supplier` TouchSpace Chat теперь работает как одно installable PWA-приложение:

- единый `login`
- единый app shell
- role-based переход после входа
- установка как отдельного окна приложения
- системные desktop push-уведомления
- deep link из уведомления в нужный экран
- отдельный экран `Настройки уведомлений`
- список устройств пользователя
- preferences по типам событий
- live counters по роли

Клиентский чат в этот этап не входит и не переводится в PWA.

## Как устроено PWA

Frontend добавляет:

- `manifest.webmanifest`
- app icons
- `display: standalone`
- service worker
- install CTA внутри приложения

Service worker кэширует только app shell и статические ассеты. Динамические chat API не кэшируются offline-first, чтобы не показывать устаревшие сообщения.

## Install flow

Поток установки сделан без агрессивного запроса:

1. Пользователь логинится во внутреннюю систему
2. В правом нижнем блоке видит карточку `Установка и уведомления`
3. Нажимает `Установить приложение`
4. Браузер показывает системный install prompt
5. После установки приложение открывается как отдельное окно

Если браузер не отдал `beforeinstallprompt`, пользователь всё равно видит понятную подсказку про установку через меню браузера.

## Notification permission flow

Разрешение на уведомления не запрашивается автоматически при загрузке.

Поток такой:

1. Пользователь явно нажимает `Включить уведомления`
2. Браузер показывает системный prompt
3. Результат обрабатывается как одно из состояний:
   - `default`
   - `granted`
   - `denied`

Если permission запрещён, UI показывает понятное сообщение, что уведомления нужно включить в настройках сайта/браузера.

## Push subscription flow

После `Notification.permission = granted` клиент:

1. запрашивает `VAPID public key` у backend
2. получает `PushSubscription` через service worker
3. отправляет subscription на backend
4. backend сохраняет подписку на уровне текущего пользователя и устройства

Архитектура допускает несколько устройств на одного пользователя.

## Backend push delivery

На backend добавлена модель `PushSubscription` с полями:

- `profileId`
- `role`
- `endpoint`
- `p256dh`
- `auth`
- `userAgent`
- `deviceLabel`
- `isActive`
- `lastUsedAt`
- `createdAt`
- `updatedAt`

Backend умеет:

- сохранить subscription
- деактивировать subscription
- отправить тестовый push
- удалить невалидную подписку при ответах `404/410` от push provider
- отдать настройки уведомлений и список устройств
- обновить preferences пользователя

Для MVP push отправляется при событиях:

- новое сообщение клиента менеджеру
- новое сообщение поставщика менеджеру
- новое сообщение менеджера поставщику
- новый `SupplierRequest`
- возврат диалога менеджеру из AI-режима

## Логика таргетинга

Минимальная логика отправки:

- менеджеру:
  - assigned manager
  - invited managers
  - если конкретный менеджер ещё не назначен, тогда активные approved managers
- поставщику:
  - по его `supplierId`
- самому отправителю push не отправляется

Перед отправкой backend фильтрует доставку по preference-переключателям профиля.

Admin-уведомления в этом MVP не расширялись глубоко: слой готов, но критичные admin-сценарии можно подключить следующим этапом.

## Deep link из уведомления

В push payload передаётся `url`.

Примеры:

- manager: `/?ticket=<ticketId>`
- supplier: `/supplier?ticket=<ticketId>`
- supplier request: `/supplier?request=<requestId>`
- admin test: `/admin`

Service worker при клике:

1. ищет уже открытую вкладку/окно приложения
2. если находит, фокусирует и переводит на нужный URL
3. если не находит, открывает новое окно приложения

Во frontend manager/supplier экранов добавлен разбор query-параметров, чтобы выбрать нужный диалог или supplier request.

## App-like UX

Для внутренней системы добавлены:

- branded PWA metadata
- installable app icons
- единый runtime-блок `Установка и уведомления`
- сервисный app shell без dev/test-site акцентов в системной зоне

Это даёт ощущение рабочего внутреннего приложения, а не набора отдельных страниц.

## Экран настроек уведомлений

Добавлен единый экран:

- `/settings`

На нём доступны:

- статус установки приложения
- статус desktop notifications
- тестовый push
- role-based live counters
- notification preferences по типам событий
- список устройств
- отключение конкретного устройства

### Preferences по типам событий

В профиле используются серверные переключатели:

- `notificationPushEnabled`
- `notifyClientChats`
- `notifySupplierChats`
- `notifySupplierRequests`
- `notifyAiHandoffs`
- `notifyAdminAlerts`

### Live counters

Backend отдаёт summary по роли.

Для `manager`:

- `unreadDialogs`
- `aiDialogs`
- `pendingSupplierRequests`

Для `supplier`:

- `unreadDialogs`
- `newRequests`
- `openDialogs`

Для `admin`:

- `pendingRegistrations`
- `slaBreaches`
- `aiHandoffs`

## Как тестировать локально

1. Убедиться, что backend и frontend запущены:

```bash
cd backend
npm run start:dev
```

```bash
cd frontend
npm run dev
```

2. В `backend/.env` должны быть настроены:

```env
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:you@example.com
```

3. Войти под внутренней ролью:

- `admin`
- `manager`
- `supplier`

4. Открыть приложение и в правом нижнем углу:

- установить приложение
- включить уведомления
- отправить тестовый push

5. Открыть `http://localhost:3000/settings` и проверить:

- live counters
- preference toggles
- devices list
- отключение конкретного устройства

6. Проверить реальные события:

- новое сообщение клиента менеджеру
- новый supplier request
- возврат чата менеджеру из AI

7. Кликнуть по системному уведомлению и убедиться, что открылся нужный экран.

## Ограничения MVP

- install prompt зависит от браузера и не всегда доступен программно
- на localhost поддержка push зависит от браузера; стабильнее тестировать в Chrome
- не сделана тонкая admin-targeting логика
- если пользователь кликнул по уведомлению без активной авторизации, deep link может потребовать повторный вход
- offline-first для чатов сознательно не внедрялся, чтобы не ломать актуальность диалогов

## Что можно сделать следующим этапом

- admin critical alerts
- granular mute rules по компаниям, очередям и отдельным supplier’ам
- более богатый app shell с unified header/profile menu
