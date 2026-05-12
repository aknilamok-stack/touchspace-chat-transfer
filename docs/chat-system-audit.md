# Chat System Audit

Дата аудита: 2026-03-22

## 1. Что уже есть

### Backend

- `backend/src/tickets/tickets.service.ts`
  - Тикеты уже создавались и читались из PostgreSQL через Prisma.
  - Уже были статусы диалога, назначение менеджера, приглашение менеджера, закрытие и reopening.
- `backend/src/messages/messages.service.ts`
  - Сообщения уже сохранялись в таблицу `Message`.
  - История диалога уже читалась из БД.
  - Уже была логика `sent/delivered/read`.
- `backend/src/supplier-requests/supplier-requests.service.ts`
  - Запросы поставщику уже сохранялись в таблицу `SupplierRequest`.
  - При создании запроса добавлялось системное сообщение в чат.
- `backend/prisma/schema.prisma`
  - Уже существовали таблицы `Ticket`, `Message`, `SupplierRequest`.
- `backend/src/typing.service.ts`
  - Typing-индикатор был отдельной in-memory логикой через `Map`, не через БД.

### Frontend

- `frontend/app/page.tsx`
  - UI менеджера уже работал с backend API.
  - История и статусы чатов подгружались с сервера.
- `frontend/app/client/page.tsx`
  - Клиентский чат уже работал, но часть состояния держалась в `localStorage`.
- `frontend/app/supplier/page.tsx`
  - Кабинет поставщика уже работал, но идентификация поставщика была жёстко зашита в frontend.

## 2. Что уже хранится в БД

### Таблица `Ticket`

- Источник: `backend/prisma/schema.prisma`
- Использование: `backend/src/tickets/tickets.service.ts`
- Уже хранилось:
  - `id`
  - `title`
  - `status`
  - `pinned`
  - `invitedManagerNames`
  - `assignedManagerId`
  - `assignedManagerName`
  - `lastResolvedByManagerId`
  - `lastResolvedByManagerName`
  - SLA-поля первого ответа
  - `createdAt`, `updatedAt`, `closedAt`

### Таблица `Message`

- Источник: `backend/prisma/schema.prisma`
- Использование: `backend/src/messages/messages.service.ts`
- Уже хранилось:
  - `id`
  - `ticketId`
  - `content`
  - `senderType`
  - `status`
  - `createdAt`

### Таблица `SupplierRequest`

- Источник: `backend/prisma/schema.prisma`
- Использование: `backend/src/supplier-requests/supplier-requests.service.ts`
- Уже хранилось:
  - `ticketId`
  - `supplierId`
  - `supplierName`
  - `requestText`
  - `status`
  - `slaMinutes`
  - `createdByManagerId`
  - response SLA поля
  - `createdAt`, `updatedAt`, `closedAt`

## 3. Что сейчас не хранилось и терялось до доработки

- Пользователи как полноценная сущность в БД отсутствовали.
  - Не было таблицы `users`, `profiles`, `accounts`.
  - Не было связи роли пользователя с БД.
- Авторизация была прототипной.
  - `frontend/lib/auth.ts`
  - логин/роль жили в `localStorage`
  - менеджеры и поставщик были захардкожены в массивы
- Клиент как пользователь не существовал как серверная сущность.
  - `frontend/app/client/page.tsx`
  - у клиента не было устойчивого серверного `user id`
- Создание клиентского обращения было неатомарным.
  - `frontend/app/client/page.tsx`
  - сначала создавался `Ticket`, потом отдельным запросом `Message`
  - если второй запрос падал, мог остаться пустой тикет без первого сообщения
- Typing-индикатор терялся после рестарта backend.
  - `backend/src/typing.service.ts`
- Reply map клиента хранился только в `localStorage`.
  - `frontend/app/client/page.tsx`
  - это UI-метаданные, не source of truth чата

## 4. Какие есть риски

- Нет настоящего production auth.
  - В проекте нет Supabase Auth, JWT, cookies, guards, middleware или server-side session validation.
  - Backend не проверял, кто реально делает запрос.
- До доработки любой фронт мог читать чужие тикеты и сообщения простым API-вызовом.
  - `GET /tickets`
  - `GET /tickets/:id/messages`
  - `GET /supplier-requests`
- Реалтайм отсутствует.
  - Сейчас используется polling каждые 4 секунды во frontend.
  - `frontend/app/page.tsx`
  - `frontend/app/client/page.tsx`
  - `frontend/app/supplier/page.tsx`
- Typing хранится в памяти процесса.
  - После рестарта backend состояние исчезает.
- Роли пользователя раньше были только UI-договорённостью.
  - Это не давало реальной защиты данных на API.

## 5. Что временное / прототипное

- `frontend/lib/auth.ts`
  - mock-логин через `localStorage`
  - тестовые учётки менеджеров и поставщика
- `frontend/app/login/page.tsx`
  - нет реальной регистрации
  - нет backend login endpoint
- `backend/src/typing.service.ts`
  - in-memory state
- polling вместо realtime

## 6. Что нужно доделать до production

- Подключить настоящий auth.
  - Предпочтительно Supabase Auth.
  - Backend должен валидировать access token и получать `user_id` из токена, а не из query/body.
- Перевести текущий viewer-context на серверную верификацию.
  - Сейчас добавлены фильтры доступа по `viewerType/viewerId`, но это ещё не криптографическая защита.
- Убрать test credentials из frontend.
- Перенести typing/realtime на WebSocket или Supabase Realtime.
- Хранить reply/attachments metadata в БД, если это нужно как часть доменной истории.

## Пользователи

### Что было найдено

- Таблиц `users` / `profiles` / `accounts` не было.
- `auth.users` Supabase из кода не использовалась.
- Регистрации нет.
- Backend login endpoint нет.
- JWT/cookies нет.
- Роли `manager` и `supplier` были только во frontend.
- Роль `client` вообще не была оформлена как пользователь.

### Что сделано

- Добавлена таблица `Profile`.
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/20260322120000_harden_chat_storage/migration.sql`
- Добавлен сервис `backend/src/profiles.service.ts`
  - автоматически upsert-ит профиль при реальных действиях пользователя
- В `Profile` теперь есть:
  - `id`
  - `authUserId`
  - `email`
  - `fullName`
  - `role`
  - `companyId`
  - `supplierId`
  - `managerStatus`
  - `createdAt`
  - `updatedAt`
- Frontend теперь передаёт устойчивые IDs:
  - клиент: `frontend/lib/auth.ts`, `frontend/app/client/page.tsx`
  - менеджер: `frontend/app/page.tsx`
  - поставщик: `frontend/app/login/page.tsx`, `frontend/app/supplier/page.tsx`

## Диалоги и сообщения

### Что было найдено

- `Ticket`, `Message`, `SupplierRequest` уже реально жили в PostgreSQL.
- История сообщений уже читалась из БД.
- Временного массива сообщений в backend не найдено.
- Основной source of truth по чатам уже был backend + PostgreSQL.

### Что сделано

- Расширена модель `Ticket`.
  - добавлены:
    - `invitedManagerIds`
    - `clientName`
    - `supplierId`
    - `supplierName`
    - `lastMessageAt`
- Расширена модель `Message`.
  - добавлены:
    - `senderRole`
    - `deliveryStatus`
    - `messageType`
    - `isInternal`
    - `senderProfileId`
    - `readAt`
- Добавлены связи `Ticket/Message/SupplierRequest -> Profile`.
- При создании/обновлении сообщений теперь обновляется `lastMessageAt`.
- Создание клиентского первого сообщения переведено на атомарный endpoint:
  - `POST /tickets/with-first-message`
  - `frontend/app/client/page.tsx`

## Сессии и авторизация

### Что было найдено

- `frontend/lib/auth.ts`
  - localStorage session
- `frontend/app/login/page.tsx`
  - mock login
- На backend:
  - нет guards
  - нет auth middleware
  - нет JWT
  - нет cookies

### Что сделано

- Добавлен базовый слой access filtering в API.
  - `backend/src/tickets/tickets.controller.ts`
  - `backend/src/messages/messages.controller.ts`
  - `backend/src/supplier-requests/supplier-requests.controller.ts`
- Backend теперь умеет фильтровать выдачу по `viewerType/viewerId`.
- Frontend стал передавать этот контекст:
  - менеджер: `frontend/app/page.tsx`
  - клиент: `frontend/app/client/page.tsx`
  - поставщик: `frontend/app/supplier/page.tsx`

Важно:

- Это улучшает изоляцию данных уже сейчас.
- Но это ещё не полноценная server-trusted auth.
- До production всё равно нужен реальный токен и server-side верификация.

## Реалтайм

### Что было найдено

- WebSocket нет.
- Supabase Realtime нет.
- SSE нет.
- Используется polling.

### Где именно

- `frontend/app/page.tsx`
- `frontend/app/client/page.tsx`
- `frontend/app/supplier/page.tsx`

### Оценка

- Для MVP работает.
- Для production лучше заменить на WebSocket или Supabase Realtime.

## Источники правды

### До доработки

- Пользователи: frontend `localStorage` и hardcoded accounts
- Диалоги: PostgreSQL (`Ticket`)
- Сообщения: PostgreSQL (`Message`)
- Supplier requests: PostgreSQL (`SupplierRequest`)
- Typing: in-memory `Map`

### После доработки

- Пользователи: PostgreSQL (`Profile`) + временно frontend local session для MVP входа
- Роли: `Profile.role` и frontend session role
- Диалоги: PostgreSQL (`Ticket`)
- Сообщения: PostgreSQL (`Message`)
- Запросы поставщикам: PostgreSQL (`SupplierRequest`)
- Typing: всё ещё in-memory

## Что именно было доработано

- Добавлена таблица `Profile`.
- Добавлены связи профилей с тикетами, сообщениями и запросами поставщикам.
- Добавлены production-поля в `Ticket` и `Message`.
- Добавлен additive migration:
  - `backend/prisma/migrations/20260322120000_harden_chat_storage/migration.sql`
- Добавлен backfill существующих данных для новых полей и профилей.
- Backend API научен фильтровать данные по роли и ID пользователя.
- Frontend начал передавать `viewerId` и устойчивые `senderId`.
- Клиентский поток создания диалога стал атомарным.
- Менеджерский поток создания запроса поставщику теперь передаёт реальный `createdByManagerId`, а не хардкод.
- Supplier flow теперь использует `supplierId`, а не только `supplierName`.

## Архитектурная карта

### Auth

- Сейчас:
  - `frontend/lib/auth.ts`
  - `frontend/app/login/page.tsx`
  - mock local auth
- Production target:
  - Supabase Auth
  - backend token verification

### Users

- Таблица:
  - `Profile`
- Файлы:
  - `backend/prisma/schema.prisma`
  - `backend/src/profiles.service.ts`

### Tickets

- Таблица:
  - `Ticket`
- API:
  - `backend/src/tickets/tickets.controller.ts`
  - `backend/src/tickets/tickets.service.ts`
- Frontend screens:
  - `frontend/app/page.tsx`
  - `frontend/app/client/page.tsx`
  - `frontend/app/supplier/page.tsx`

### Messages

- Таблица:
  - `Message`
- API:
  - `backend/src/messages/messages.controller.ts`
  - `backend/src/messages/messages.service.ts`

### Supplier Requests

- Таблица:
  - `SupplierRequest`
- API:
  - `backend/src/supplier-requests/supplier-requests.controller.ts`
  - `backend/src/supplier-requests/supplier-requests.service.ts`

### Frontend screens

- Менеджер:
  - `frontend/app/page.tsx`
- Клиент:
  - `frontend/app/client/page.tsx`
- Поставщик:
  - `frontend/app/supplier/page.tsx`
- Логин:
  - `frontend/app/login/page.tsx`

## Итог

- Чаты и сообщения уже были в БД, это не mock.
- Главная проблема была не в хранении сообщений, а в отсутствии нормальной модели пользователей и реальной серверной авторизации.
- После доработки появился явный слой `Profile` и более нормальная связность данных.
- История сообщений не должна теряться после перезагрузки.
- Пустые тикеты без первого сообщения больше не должны появляться в клиентском сценарии.
- Доступ стал заметно безопаснее, но до настоящего production security ещё нужен полноценный auth flow.
