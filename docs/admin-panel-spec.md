# TouchSpace Admin Panel MVP Spec

## Цель этапа

Собрать автономную demo/pilot-админку для чат-системы TouchSpace без интеграции с основной платформой. Админка должна быть центром управления операционным потоком:

- модерировать вход новых пользователей
- управлять доступом
- просматривать все диалоги
- видеть общую и ролевую аналитику
- контролировать SLA и качество ответов
- закладывать основу под будущую AI-аналитику

## Что входит в MVP

### 1. Dashboard / Общий обзор

Главный экран `/admin` показывает:

- общее количество диалогов
- количество новых, активных и решённых диалогов
- среднее время первого ответа менеджера
- среднее время ответа поставщика
- количество активных менеджеров и поставщиков
- количество нарушений SLA
- количество регистраций в статусе `pending`

Дополнительные блоки:

- динамика диалогов по дням
- нагрузка по менеджерам
- нагрузка по поставщикам
- top причин обращений

### 2. Регистрации

Экран `/admin/registrations` нужен для moderation flow.

Показываем:

- имя
- email
- компания
- роль
- дата регистрации
- статус заявки
- комментарий администратора

Статусы:

- `pending`
- `approved`
- `rejected`

Действия API:

- получить список регистраций
- открыть карточку регистрации
- approve
- reject

### 3. Пользователи

Экран `/admin/users` показывает единый каталог профилей.

Поля:

- имя
- email
- роль
- статус доступа
- approval status
- компания
- дата создания
- дата последнего входа
- количество диалогов и supplier requests

Поддерживаемые роли:

- `admin`
- `manager`
- `supplier`
- `client`

Поддерживаемые статусы:

- `active`
- `inactive`
- `blocked`
- `pending_approval`

Действия API:

- получить список пользователей
- открыть пользователя
- изменить роль
- изменить статус
- создать пользователя вручную

### 4. Диалоги

Экран `/admin/dialogs` нужен для read-only контроля переписки.

В списке показываем:

- id диалога
- клиент
- менеджер
- поставщик
- статус
- дата создания
- время последнего сообщения
- наличие supplier escalation
- наличие SLA violation

В карточке диалога:

- вся история сообщений
- роль и автор каждого сообщения
- supplier request и его статус
- время первого ответа
- время ответа поставщика
- системные события

### 5. Аналитика

Отдельные экраны:

- `/admin/analytics`
- `/admin/analytics/managers`
- `/admin/analytics/suppliers`

Аналитика считается на backend.

Общая аналитика:

- количество диалогов за период
- новые / решённые / просроченные
- среднее время первого ответа
- среднее время закрытия
- доля диалогов с эскалацией поставщику
- количество сообщений на диалог
- top topics
- распределение по дням

По менеджерам:

- диалоги в работе
- обработанные диалоги
- среднее время первого ответа
- среднее время закрытия
- SLA просрочки
- количество эскалаций к поставщику
- top reasons

По поставщикам:

- количество входящих запросов
- количество отвеченных запросов
- среднее время ответа
- SLA просрочки
- количество связанных диалогов
- top reasons

### 6. SLA / Контроль качества

Экран `/admin/sla` показывает:

- диалоги с нарушением SLA
- менеджеров с наибольшим количеством просрочек
- поставщиков с наибольшим количеством просрочек
- среднее время ответа по ролям
- проблемные диалоги для разбора

## Frontend-структура

Добавлены маршруты:

- `/admin`
- `/admin/registrations`
- `/admin/users`
- `/admin/dialogs`
- `/admin/analytics`
- `/admin/analytics/managers`
- `/admin/analytics/suppliers`
- `/admin/sla`

Особенности UI-каркаса:

- отдельный admin layout
- боковая навигация
- metric cards
- таблицы
- filter chips
- empty state
- loading state
- error/fallback state

Если backend недоступен, страницы остаются пригодными для demo за счёт mock-friendly fallback-данных.

## Backend API

Добавлен изолированный модуль `admin` со следующими endpoint:

### Overview

- `GET /admin/overview`

### Registrations

- `GET /admin/registrations`
- `GET /admin/registrations/:id`
- `PATCH /admin/registrations/:id/approve`
- `PATCH /admin/registrations/:id/reject`

### Users

- `GET /admin/users`
- `GET /admin/users/:id`
- `POST /admin/users`
- `PATCH /admin/users/:id`

### Dialogs

- `GET /admin/dialogs`
- `GET /admin/dialogs/:id`

### Analytics

- `GET /admin/analytics/overview`
- `GET /admin/analytics/managers`
- `GET /admin/analytics/managers/:id`
- `GET /admin/analytics/suppliers`
- `GET /admin/analytics/suppliers/:id`

### SLA

- `GET /admin/sla`

## Данные и модели

### Profile

Расширен полями:

- `status`
- `approvalStatus`
- `companyName`
- `approvalComment`
- `lastLoginAt`
- `createdByAdminId`
- `isActive`

### Ticket

Расширен полями:

- `resolvedAt`
- `slaBreached`
- `supplierEscalatedAt`
- `topicCategory`
- `sentiment`
- `aiSummary`
- `aiTags`
- `insightFlags`

### Message

Уже содержал важные поля для admin/AI-ready сценариев:

- `senderRole`
- `deliveryStatus`
- `messageType`
- `createdAt`

### SupplierRequest

Расширен полями:

- `requestedAt`
- `respondedAt`

### RegistrationRequest

Добавлена новая сущность для moderation flow:

- `email`
- `fullName`
- `companyName`
- `role`
- `status`
- `comment`
- `profileId`
- `reviewedByAdminId`
- `reviewedAt`

## AI-ready foundation

На этом этапе AI глубоко не внедряется, но foundation уже подготовлен:

- у тикета есть поля `topicCategory`, `sentiment`, `aiSummary`, `aiTags`, `insightFlags`
- у сообщений и supplier requests уже хранятся роли, timestamps и статусы
- аналитика строится на backend, значит позже можно подключить AI enrichment pipeline без перелома клиентского слоя

Рекомендуемое развитие следующего этапа:

- cron/job для background enrichment
- topic extraction и summary по завершённым диалогам
- sentiment / risk scoring
- отдельная таблица audit / insight snapshots

## Ограничения MVP

На этом этапе специально не делаем:

- интеграцию с основной платформой TouchSpace
- production-grade RBAC и SSO
- редактирование переписки админом
- deep AI-аналитику внутри продукта
- сложные materialized views и отдельный data mart

## Следующий этап

После утверждения каркаса логично добавить:

- реальные CRUD-формы внутри admin UI
- detail pages для registration, user, manager, supplier
- auth guard для роли `admin`
- серверные фильтры с query params на UI
- seed/demo data для стабильных презентаций
- background aggregation layer для быстрых аналитических срезов
