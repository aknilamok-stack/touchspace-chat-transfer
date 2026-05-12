# TouchSpace Chat: общая документация для разработчиков

Дата подготовки: 2026-05-12

## 1. Назначение проекта

`touchspace-chat` — это система омниканального чата TouchSpace для коммуникации между клиентами, менеджерами TouchSpace, поставщиками, управленцами и администраторами.

Основная идея системы: все обращения клиента хранятся как диалоги/тикеты, а внутри каждого диалога ведётся история сообщений, служебных событий, назначений, запросов поставщикам, AI-ответов, email-сообщений, push-уведомлений и аналитических метрик.

Проект сейчас покрывает не только сам чат, но и рабочее окружение вокруг него:

- клиентский чат;
- рабочее место менеджера;
- кабинет поставщика;
- кабинеты управленцев менеджеров и поставщиков;
- административную панель;
- AI-режим ответа клиенту;
- запросы поставщикам;
- push-уведомления;
- email-интеграцию;
- PWA/desktop-окружение;
- аналитику, SLA и операционные настройки.

## 2. Технологический стек

### Frontend

Frontend расположен в директории `frontend`.

Используется:

- Next.js App Router;
- React;
- TypeScript;
- CSS через `frontend/app/globals.css`;
- клиентские страницы в `frontend/app`;
- общие frontend-утилиты в `frontend/lib`;
- переиспользуемые компоненты в `frontend/components`.

Ключевые страницы:

- `frontend/app/page.tsx` — основной интерфейс менеджера;
- `frontend/app/client/page.tsx` — клиентский чат;
- `frontend/app/supplier/page.tsx` — кабинет поставщика;
- `frontend/app/manager-supervisor/page.tsx` — кабинет управленца менеджеров;
- `frontend/app/supplier-supervisor/page.tsx` — кабинет управленца поставщика;
- `frontend/app/admin/*` — административная панель;
- `frontend/app/login/page.tsx` — вход;
- `frontend/app/settings/page.tsx` — настройки профиля и уведомлений;
- `frontend/app/change-password/page.tsx` — смена пароля.

Базовый URL backend определяется в `frontend/lib/api.ts`. По умолчанию локально используется `http://localhost:3001`.

### Backend

Backend расположен в директории `backend`.

Используется:

- NestJS;
- TypeScript;
- Prisma;
- MySQL как основной провайдер в `backend/prisma/schema.prisma`;
- REST API;
- SMTP/IMAP для email-интеграции;
- Web Push для push-уведомлений;
- OpenAI или DeepSeek для AI-функций.

Ключевые backend-модули:

- `backend/src/tickets` — диалоги/тикеты;
- `backend/src/messages` — сообщения;
- `backend/src/supplier-requests` — запросы поставщикам;
- `backend/src/profiles.service.ts` — профили и статусы присутствия;
- `backend/src/auth.service.ts` — логин, сессии, смена пароля;
- `backend/src/admin` — административная панель и аналитика;
- `backend/src/supervisors.*` — управление операторами через управленцев;
- `backend/src/notifications.*` — настройки уведомлений;
- `backend/src/push.*` — push-подписки и отправка уведомлений;
- `backend/src/email` — SMTP/IMAP;
- `backend/src/chat-ai.service.ts` — AI-ответы в клиентском чате.

## 3. Основные роли

Роли определены на backend в `backend/src/role.utils.ts` и на frontend в `frontend/lib/auth.ts`.

### `client`

Клиент создаёт обращения и общается с TouchSpace через клиентский чат.

Клиент может:

- создать новый диалог с первым сообщением;
- продолжать существующий диалог;
- отправлять текстовые сообщения;
- прикреплять файлы;
- видеть статусы доставки/прочтения;
- видеть набор сообщения другой стороной;
- оценить менеджера после решения обращения.

Клиентская сессия хранится на frontend в `localStorage` через `getOrCreateClientSession()` и может включать:

- `clientId`;
- `clientName`;
- торговую точку;
- текущего пользователя;
- email/телефон;
- данные суперпользователя;
- canonical email.

### `manager`

Менеджер TouchSpace обрабатывает клиентские обращения.

Менеджер может:

- видеть список доступных диалогов;
- брать входящий диалог в работу;
- отвечать клиенту;
- создавать диалог с клиентом вручную;
- отправлять email-сообщения из диалога;
- прикреплять файлы;
- редактировать свои сообщения в течение ограниченного окна;
- закреплять диалоги;
- закрывать и переоткрывать диалоги;
- приглашать других менеджеров;
- назначать ответственного менеджера;
- создавать запрос поставщику;
- управлять паузой/возвратом поставщика в диалог;
- вести внутренние сообщения;
- видеть контакты и историю посещённых клиентом страниц.

У менеджера есть статус присутствия:

- `online`;
- `break`;
- `offline`.

Он хранится в `Profile.managerStatus` и обновляется через `PATCH /profiles/:id/manager-status`.

### `supplier`

Поставщик отвечает на запросы менеджеров и участвует в диалоге, когда менеджер подключает поставщика.

Поставщик может:

- видеть запросы, относящиеся к своей компании/поставщику;
- брать запрос в работу;
- отвечать менеджеру и/или в диалог по запросу;
- отправлять вложения;
- менять статус запроса;
- возвращать запрос в очередь;
- запрашивать возврат в активный диалог, если менеджер поставил поставщика на паузу.

У поставщика есть статус присутствия:

- `online`;
- `break`;
- `offline`.

Он хранится в `Profile.supplierStatus` и обновляется через `PATCH /profiles/:id/supplier-status`.

### `manager_supervisor`

Управленец менеджеров supervises операторов-менеджеров.

Он может:

- видеть операторов;
- управлять доступом операторов к чатам;
- управлять аккаунтами операторов;
- переиздавать пароль;
- смотреть операционную аналитику.

### `supplier_supervisor`

Управленец поставщика supervises сотрудников поставщика.

Он может:

- видеть операторов своей компании;
- создавать операторов;
- включать/отключать операторов;
- управлять доступом к чатам;
- переиздавать пароль;
- смотреть аналитику по своей зоне ответственности.

### `admin`

Администратор управляет системой целиком.

Администратор может:

- просматривать overview;
- управлять регистрациями;
- создавать и редактировать пользователей;
- блокировать/активировать пользователей;
- переиздавать пароли;
- смотреть список диалогов;
- открывать детали диалога;
- запускать AI-анализ диалога;
- смотреть аналитику менеджеров, поставщиков, инсайтов и SLA.

Админские endpoint'ы находятся под `/admin` и защищены `AdminGuard`.

### `ai`

AI — системный участник диалога, который может отвечать клиенту в AI-режиме.

AI может:

- сформировать ответ клиенту;
- определить, нужно ли передать диалог менеджеру;
- создать служебное сообщение о handoff;
- вернуть диалог в очередь менеджера;
- отправить push-уведомление менеджерам при handoff.

Логика находится в `backend/src/chat-ai.service.ts`.

### `system`

Системный участник пишет служебные сообщения.

Примеры:

- создан запрос поставщику;
- поставщик взял запрос в работу;
- запрос поставщику закрыт/отменён/отвечен;
- поставщик поставлен на паузу или возвращён в диалог;
- AI передал диалог менеджеру;
- менеджеры офлайн, клиент получил автоответ.

## 4. Основные доменные сущности

### `Profile`

Профиль пользователя или участника системы.

Ключевые поля:

- `id`;
- `email`;
- `phone`;
- `authLogin`;
- `passwordHash`;
- `fullName`;
- `role`;
- `status`;
- `approvalStatus`;
- `companyName`;
- `companyId`;
- `supplierId`;
- `supervisorProfileId`;
- `managerStatus`;
- `supplierStatus`;
- `activeSessionToken`;
- `chatAccessEnabled`;
- настройки уведомлений.

Профиль используется для:

- авторизации;
- ролей;
- присутствия;
- связи сообщений с отправителем;
- привязки поставщиков и управленцев;
- ограничения доступа к отправке сообщений.

### `Ticket`

Главная сущность диалога.

Ticket хранит:

- заголовок;
- статус;
- режим диалога;
- текущего обработчика;
- AI-флаги;
- назначенного менеджера;
- приглашённых менеджеров;
- данные клиента;
- данные торговой точки;
- email/телефон клиента;
- данные суперпользователя;
- данные поставщика;
- SLA-поля;
- аналитику;
- закрепление;
- даты создания, обновления, закрытия.

Важные поля режима:

- `conversationMode` — общий режим диалога: например `manager`, `ai`, `direct_supplier`;
- `currentHandlerType` — кто сейчас фактически ведёт диалог: менеджер, AI и т.д.;
- `aiEnabled` — включён ли AI;
- `status` — операционный статус тикета.

### `Message`

Сообщение внутри тикета.

Ключевые поля:

- `content`;
- `senderType`;
- `senderRole`;
- `senderProfileId`;
- `ticketId`;
- `status`;
- `deliveryStatus`;
- `messageType`;
- `transport`;
- email-поля `toEmail`, `fromEmail`, `subject`, `messageId`, `inReplyTo`, `references`;
- `replyToMessageId`;
- `replyToContent`;
- `isInternal`;
- `readAt`;
- `createdAt`.

Типы отправителей:

- `client`;
- `manager`;
- `supplier`;
- `ai`;
- `system`.

Типы транспорта:

- `chat`;
- `email`.

### `SupplierRequest`

Запрос поставщику, созданный менеджером из диалога.

Хранит:

- `ticketId`;
- `supplierId`;
- `supplierName`;
- назначенного сотрудника поставщика;
- текст запроса;
- статус;
- SLA-поля;
- даты взятия в работу, ответа, закрытия;
- информацию о возврате в очередь.

Основные статусы:

- `pending`;
- `in_progress`;
- `answered`;
- `closed`;
- `cancelled`.

При создании запроса:

- создаётся запись `SupplierRequest`;
- в чат добавляется системное сообщение;
- тикет переводится в `waiting_supplier`;
- отправляется push поставщику, если есть активные профили.

### `TicketContact`

Контакты клиента внутри тикета.

Контакты бывают:

- email;
- phone.

Часть контактов строится автоматически из данных тикета/профиля, часть добавляется менеджером вручную.

### `TicketPageView`

История страниц, которые смотрел клиент.

Используется, чтобы менеджер понимал контекст обращения: где был клиент, какую страницу или сущность смотрел, откуда пришёл.

### `ManagerMessageSuggestion`

Подсказки менеджеру на основе часто используемых фраз.

Backend сохраняет подходящие сообщения менеджера и увеличивает `usageCount`, чтобы затем предлагать менеджеру повторно использовать типовые ответы.

### `PushSubscription`

Web Push подписка устройства пользователя.

Хранит:

- `profileId`;
- `role`;
- `endpoint`;
- ключи `p256dh` и `auth`;
- user agent;
- device label;
- активность подписки.

## 5. Основные сценарии работы

### 5.1. Клиент создаёт обращение

1. Frontend клиента собирает данные клиентской сессии.
2. Клиент отправляет первое сообщение.
3. Frontend вызывает `POST /tickets/with-first-message`.
4. Backend атомарно создаёт `Ticket` и первое `Message`.
5. Если менеджеры офлайн, backend может добавить системный автоответ.
6. Диалог появляется в списке менеджеров.

Endpoint:

```http
POST /tickets/with-first-message
```

### 5.2. Клиент или оператор отправляет сообщение

1. Frontend вызывает `POST /messages`.
2. Backend проверяет тикет.
3. Для менеджера проверяется, может ли он писать в этот диалог.
4. Для менеджера/поставщика проверяется `chatAccessEnabled`.
5. Для поставщика дополнительно проверяется состояние supplier sync: если поставщик на паузе, сообщение запрещается.
6. Сообщение сохраняется в БД.
7. Обновляется `lastMessageAt` и связанные SLA/статусные поля.
8. При необходимости отправляются push-уведомления.
9. Если включён AI-режим, может быть сгенерирован AI-ответ.

Endpoint:

```http
POST /messages
```

### 5.3. Менеджер берёт диалог в работу

Менеджер вызывает claim endpoint.

```http
PATCH /tickets/:id/claim
```

Backend назначает менеджера, фиксирует время взятия и обновляет статус.

### 5.4. Менеджер приглашает другого менеджера

Endpoint:

```http
PATCH /tickets/:id/invite-manager
```

Приглашённые менеджеры сохраняются в JSON-полях:

- `invitedManagerIds`;
- `invitedManagerNames`.

Менеджера можно убрать:

```http
PATCH /tickets/:id/remove-invited-manager
```

### 5.5. Менеджер создаёт запрос поставщику

Endpoint:

```http
POST /supplier-requests
```

Backend:

- создаёт `SupplierRequest`;
- добавляет системное сообщение в чат;
- переводит тикет в `waiting_supplier`;
- сохраняет `supplierId`, `supplierName`, `supplierEscalatedAt`;
- отправляет push поставщику.

### 5.6. Поставщик берёт запрос в работу

Endpoint:

```http
PATCH /supplier-requests/:id/status
```

Статус переводится в `in_progress`, фиксируется исполнитель и создаётся системное сообщение.

### 5.7. Поставщик отвечает на запрос

Поставщик отправляет обычное сообщение через:

```http
POST /messages
```

После ответа статус запроса может быть переведён в `answered`, а тикет возвращается в `in_progress`.

### 5.8. Пауза поставщика и возврат в диалог

Для управления участием поставщика используется endpoint:

```http
POST /supplier-requests/:id/sync
```

Действия:

- `pause` — менеджер ставит поставщика на паузу;
- `resume` — менеджер возвращает поставщика в диалог;
- `resume_request` — поставщик просит вернуться;
- `resume_defer` — менеджер откладывает возврат.

Состояние хранится не отдельными колонками, а через служебные сообщения специального типа `SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE`. Затем состояние вычисляется утилитой `getSupplierRequestSyncState()`.

### 5.9. Закрытие и переоткрытие диалога

Закрытие:

```http
PATCH /tickets/:id/resolve
```

Переоткрытие:

```http
PATCH /tickets/:id/reopen
```

При закрытии сохраняется информация о менеджере, который решил обращение, и время решения.

### 5.10. AI-режим

AI можно включить:

```http
POST /tickets/:id/ai/enable
```

И выключить:

```http
POST /tickets/:id/ai/disable
```

Когда AI отвечает:

1. `ChatAiService` собирает последние сообщения.
2. AI должен вернуть структурированный JSON.
3. Backend создаёт сообщение `ai_response`.
4. Если AI считает, что нужен менеджер, тикет возвращается в режим менеджера.
5. Создаётся системное сообщение о handoff.
6. Менеджерам отправляется push.

Провайдер AI выбирается через переменные окружения:

- `AI_PROVIDER=openai|deepseek`;
- `OPENAI_API_KEY`;
- `DEEPSEEK_API_KEY`;
- model-переменные для chat/admin задач.

### 5.11. Email-сообщения

Сообщение менеджера может быть отправлено как email, если `transport=email`.

Backend:

- отправляет письмо через SMTP;
- сохраняет email metadata в `Message`;
- поддерживает `messageId`, `inReplyTo`, `references`;
- умеет искать тикет по email headers/subject для входящих писем.

Email-логика находится в `backend/src/email`.

### 5.12. Push-уведомления

Push используется для:

- новых клиентских сообщений;
- запросов поставщику;
- AI handoff;
- административных и операционных событий.

Endpoint'ы:

```http
GET /push/public-key
POST /push/subscriptions
DELETE /push/subscriptions
POST /push/test
```

Настройки уведомлений:

```http
GET /notifications/settings
PATCH /notifications/preferences
```

## 6. Авторизация и сессии

Сейчас используется backend-авторизация через `Profile`.

Основные endpoint'ы:

```http
POST /auth/login
POST /auth/change-password
POST /auth/validate-session
POST /auth/logout
```

При логине:

- пользователь ищется по `authLogin` или `email`;
- пароль проверяется через `scrypt`;
- создаётся `activeSessionToken`;
- профиль получает `lastLoginAt`;
- менеджер или поставщик переводится в `online`.

Frontend хранит сессию в `localStorage` под ключом `touchspace_auth`.

Важно: часть API всё ещё принимает `viewerType`, `viewerId`, `managerId`, `supplierId` из query/body. Это удобно для текущей реализации, но требует осторожности: для production желательно усилить серверную проверку через доверенный token/session context, чтобы backend не полагался на переданные frontend-ом идентификаторы.

## 7. Доступ к данным

### Чтение тикетов

Основной endpoint:

```http
GET /tickets
```

Фильтрация зависит от `viewerType`.

Для клиента:

- совпадение по `clientId`;
- или совпадение торговой точки и email.

Для поставщика:

- тикет напрямую связан с `supplierId`;
- или есть supplier request для этого поставщика.

Для менеджера:

- видны обычные диалоги;
- direct supplier диалоги видны только назначенному менеджеру.

### Чтение сообщений

Endpoint:

```http
GET /tickets/:id/messages
```

Backend проверяет доступ через `viewerType`, `viewerId`, `viewerEmail`, `tradePointName`.

Для менеджера чтение разрешено при наличии `viewerId`.

Для клиента и поставщика проверяется связь с тикетом.

### Отправка сообщений

Менеджер может писать, если:

- тикет ещё не назначен;
- или он назначенный менеджер;
- или он приглашён в диалог.

Поставщик может писать, если:

- у него есть доступ к тикету через supplier request;
- запрос не находится в состоянии pause/awaiting manager;
- у профиля включён `chatAccessEnabled`.

## 8. Статусы и режимы

### Статусы тикета

В коде используются разные операционные статусы, в том числе:

- `new`;
- `in_progress`;
- `waiting_client`;
- `waiting_supplier`;
- `resolved`;
- другие значения, зависящие от сценариев.

Точный набор не зафиксирован enum-ом в Prisma: поле `Ticket.status` имеет тип `String`. Поэтому при добавлении новых статусов нужно синхронизировать backend-логику, frontend-фильтры и админскую аналитику.

### Режимы диалога

Важные поля:

- `conversationMode`;
- `currentHandlerType`;
- `aiEnabled`.

Примеры режимов:

- менеджер ведёт диалог;
- AI ведёт диалог;
- диалог возвращён менеджеру;
- direct supplier диалог.

### Статусы сообщений

У сообщения есть:

- `status`;
- `deliveryStatus`;
- `readAt`.

Используются значения:

- `sent`;
- `delivered`;
- `read`.

## 9. Вложения

Endpoint:

```http
POST /messages/attachment
```

Ограничения:

- максимум 5 файлов;
- размер файла до 5 МБ;
- файлы сохраняются в `./uploads`;
- имя файла нормализуется.

Вложение создаётся как сообщение специального типа/контента, а frontend отображает его через attachment-компоненты.

## 10. Typing-индикатор

Endpoint'ы:

```http
POST /tickets/:id/typing
GET /tickets/:id/typing
```

Логика находится в `backend/src/typing.service.ts`.

Состояние typing хранится in-memory, поэтому:

- переживает только жизнь процесса backend;
- сбрасывается при рестарте;
- не синхронизируется между несколькими инстансами backend.

Для production и горизонтального масштабирования typing лучше вынести в Redis/WebSocket/SSE или другой realtime-слой.

## 11. Realtime и polling

Сейчас проект использует polling со стороны frontend.

WebSocket, SSE или Supabase Realtime в текущей реализации не являются центральным механизмом чата.

Это проще для MVP, но имеет ограничения:

- задержка обновлений зависит от интервала polling;
- больше лишних HTTP-запросов;
- typing и presence выглядят менее realtime;
- сложнее масштабировать активные диалоги.

## 12. Административная панель

Админка находится в:

- `frontend/app/admin`;
- `frontend/components/admin`;
- `backend/src/admin`.

Админские возможности:

- overview;
- заявки на регистрацию;
- пользователи;
- диалоги;
- аналитика;
- менеджеры;
- поставщики;
- insights;
- SLA;
- AI-summary.

Админский API:

```http
GET /admin/overview
GET /admin/registrations
POST /admin/registrations
PATCH /admin/registrations/:id/approve
PATCH /admin/registrations/:id/reject
GET /admin/users
POST /admin/users
PATCH /admin/users/:id
DELETE /admin/users/:id
GET /admin/dialogs
GET /admin/dialogs/:id
POST /admin/dialogs/:id/ai-analyze
GET /admin/analytics/overview
GET /admin/analytics/managers
GET /admin/analytics/suppliers
GET /admin/analytics/insights
GET /admin/sla
```

## 13. Кабинеты управленцев

Код:

- `backend/src/supervisors.controller.ts`;
- `backend/src/supervisors.service.ts`;
- `frontend/components/supervisor/operators-settings-page.tsx`;
- страницы `manager-supervisor` и `supplier-supervisor`.

Возможности:

- список операторов;
- создание оператора;
- включение/отключение оператора;
- управление доступом к чатам;
- изменение логина/email;
- переиздание пароля;
- аналитика по операторам.

У поставщика supervisor ограничен своей компанией/`supplierId`.

## 14. PWA и desktop

В проекте есть PWA-часть:

- `frontend/app/manifest.ts`;
- `frontend/public/sw.js`;
- `frontend/components/pwa/app-runtime-hub.tsx`;
- `frontend/lib/push-notifications.ts`.

Также есть desktop-обёртка:

- `desktop/src/main.js`;
- `desktop/src/preload.js`;
- `desktop/src/notification.html`;
- `desktop/src/notification-preload.js`.

Desktop использует отдельное хранение auth через `window.touchspaceDesktop?.authStorage`.

## 15. Важные API endpoint'ы

### Auth

```http
POST /auth/login
POST /auth/change-password
POST /auth/validate-session
POST /auth/logout
```

### Profiles

```http
GET /profiles/manager-statuses
GET /profiles/supplier-statuses
PATCH /profiles/:id/manager-status
PATCH /profiles/:id/supplier-status
PATCH /profiles/:id/basic
```

### Tickets

```http
POST /tickets
POST /tickets/with-first-message
POST /tickets/manager-created-client
GET /tickets
GET /tickets/manager-supplier-dialogs
GET /tickets/supplier-manager-dialogs
POST /tickets/:id/typing
GET /tickets/:id/typing
GET /tickets/:id/contacts
POST /tickets/:id/contacts
PATCH /tickets/:id/contacts/:contactId
POST /tickets/:id/contacts/:contactId/delete
POST /tickets/page-view
GET /tickets/:id/page-views
PATCH /tickets/:id/pin
PATCH /tickets/:id/resolve
PATCH /tickets/:id/reopen
PATCH /tickets/:id/invite-manager
PATCH /tickets/:id/remove-invited-manager
PATCH /tickets/:id/assign-manager
PATCH /tickets/:id/claim
POST /tickets/:id/ai/enable
POST /tickets/:id/ai/disable
```

### Messages

```http
POST /messages
PATCH /messages/:id
GET /messages/manager-suggestions
POST /messages/attachment
GET /tickets/:id/messages
```

### Supplier requests

```http
POST /supplier-requests
GET /supplier-requests
GET /tickets/:id/supplier-requests
PATCH /supplier-requests/:id/status
POST /supplier-requests/:id/sync
```

### Supervisors

```http
GET /supervisors/supplier-companies
GET /supervisors/operators
GET /supervisors/analytics
PATCH /supervisors/operators/:id/chat-access
PATCH /supervisors/operators/:id/account
POST /supervisors/operators
PATCH /supervisors/operators/:id/activation
POST /supervisors/operators/:id/reissue-password
```

### Notifications and push

```http
GET /notifications/settings
GET /notifications/manager-candidates
GET /notifications/supplier-candidates
PATCH /notifications/preferences
POST /notifications/subscriptions/:id/deactivate

GET /push/public-key
POST /push/subscriptions
DELETE /push/subscriptions
POST /push/test
```

## 16. Конфигурация окружения

### Frontend

Основная переменная:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Если переменная не задана, frontend пытается определить API base URL автоматически.

### Backend

Важные группы переменных:

- подключение к MySQL/Prisma;
- SMTP;
- IMAP;
- VAPID/Web Push;
- OpenAI/DeepSeek.

AI:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_CHAT_MODEL=...
OPENAI_ADMIN_MODEL=...

AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_CHAT_MODEL=...
DEEPSEEK_ADMIN_MODEL=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Email:

```env
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM_EMAIL=...
IMAP_HOST=...
IMAP_PORT=...
IMAP_USER=...
IMAP_PASS=...
```

## 17. Текущие ограничения и зоны риска

### Доверие к viewer context

Часть endpoint'ов принимает `viewerType`, `viewerId`, `managerId`, `supplierId` из клиента. Это нужно усилить, чтобы backend получал роль и id из проверенной серверной сессии, а не из параметров запроса.

### Отсутствие полноценного realtime

Сейчас используется polling. Для живого чата лучше добавить WebSocket/SSE или другой realtime-транспорт.

### Typing in-memory

Typing хранится в памяти backend-процесса. При рестарте или нескольких инстансах состояние будет теряться.

### Строковые статусы

Многие статусы хранятся как `String`, а не enum. Это даёт гибкость, но повышает риск рассинхронизации frontend/backend/analytics.

### JSON-поля

Некоторые связи, например приглашённые менеджеры, хранятся в JSON. Это проще, но сложнее для запросов, индексов и консистентности.

### Email и AI зависят от окружения

SMTP/IMAP и AI-функции работают только при корректных env-переменных. Без них соответствующие сценарии будут недоступны или вернут ошибку.

## 18. Где разработчику смотреть код

### Если нужно изменить список диалогов

- `backend/src/tickets/tickets.service.ts`;
- `backend/src/tickets/tickets.controller.ts`;
- `frontend/app/page.tsx`;
- `frontend/app/client/page.tsx`;
- `frontend/app/supplier/page.tsx`;
- `frontend/lib/dialog-list.ts`.

### Если нужно изменить отправку сообщений

- `backend/src/messages/messages.service.ts`;
- `backend/src/messages/messages.controller.ts`;
- `frontend/app/page.tsx`;
- `frontend/app/client/page.tsx`;
- `frontend/app/supplier/page.tsx`;
- `frontend/lib/chat-attachments.ts`.

### Если нужно изменить поставщиков

- `backend/src/supplier-requests`;
- `frontend/app/supplier/page.tsx`;
- `frontend/app/supplier-supervisor/page.tsx`;
- `frontend/app/page.tsx`.

### Если нужно изменить роли или авторизацию

- `backend/src/auth.service.ts`;
- `backend/src/auth.controller.ts`;
- `backend/src/profiles.service.ts`;
- `backend/src/role.utils.ts`;
- `frontend/lib/auth.ts`;
- `frontend/app/login/page.tsx`;
- `frontend/components/auth/session-guard.tsx`.

### Если нужно изменить AI

- `backend/src/chat-ai.service.ts`;
- `backend/src/admin/admin-ai.service.ts`;
- `backend/src/ai-text-client.ts`;
- `docs/ai-chat-mode-spec.md`.

### Если нужно изменить push

- `backend/src/push.service.ts`;
- `backend/src/push.controller.ts`;
- `backend/src/notifications.service.ts`;
- `frontend/lib/push-notifications.ts`;
- `frontend/components/pwa/app-runtime-hub.tsx`;
- `docs/pwa-notifications-spec.md`.

### Если нужно изменить админку

- `backend/src/admin`;
- `frontend/app/admin`;
- `frontend/components/admin`;
- `frontend/lib/admin-api.ts`;
- `docs/admin-panel-spec.md`.

## 19. Краткая ментальная модель

Самая важная модель проекта:

1. `Profile` описывает участника и его роль.
2. `Ticket` описывает диалог.
3. `Message` хранит историю диалога.
4. `SupplierRequest` подключает поставщика к тикету.
5. `Ticket.status`, `conversationMode`, `currentHandlerType` и `aiEnabled` определяют, кто и в каком режиме сейчас ведёт обращение.
6. Frontend регулярно опрашивает backend и отображает разные рабочие места поверх одних и тех же backend-сущностей.
7. Админка и аналитика читают те же сущности, но в разрезе контроля качества, SLA, пользователей и операционных показателей.

## 20. Рекомендации для дальнейшего развития

1. Ввести server-trusted auth context для всех endpoint'ов.
2. Перевести realtime-часть на WebSocket/SSE.
3. Вынести typing/presence в Redis или другой общий слой.
4. Зафиксировать статусы тикетов, сообщений и запросов поставщиков как enum или централизованные константы.
5. Добавить e2e-тесты на ключевые сценарии: клиент создаёт тикет, менеджер отвечает, поставщик подключается, AI делает handoff.
6. Разделить публичный клиентский API и внутренний операторский API по guards/permissions.
7. Добавить документацию по схемам request/response для основных endpoint'ов.
