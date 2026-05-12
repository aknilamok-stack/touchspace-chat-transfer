# TouchSpace Chat: deploy на Vercel + Render

## Целевая схема

На первом этапе делаем простую публичную demo-схему:

- `frontend` → Vercel
- `backend` → Render
- без собственного домена
- публичные URL вида:
  - `https://<frontend-project>.vercel.app`
  - `https://<backend-project>.onrender.com`

Это уже позволит:

- открыть систему с любого компьютера
- логиниться под ролями
- использовать админку, менеджера и поставщика
- тестировать PWA

## Что уже подготовлено в проекте

- backend env examples: [backend/.env.example](/Users/aknila/Desktop/touchspace-chat/backend/.env.example)
- frontend env examples: [frontend/.env.example](/Users/aknila/Desktop/touchspace-chat/frontend/.env.example)
- backend config для Render: [render.yaml](/Users/aknila/Desktop/touchspace-chat/render.yaml)
- backend CORS теперь умеет безопасно пропускать Vercel preview/app domains через `ALLOW_VERCEL_PREVIEWS`

## 1. Что нужно сделать для backend на Render

### Вариант через Render UI

1. Зайти в Render
2. Нажать `New Web Service`
3. Подключить GitHub-репозиторий
4. Выбрать этот repo
5. Указать:
   - `Root Directory`: `backend`
   - `Runtime`: `Node`
   - `Build Command`: `npm ci && npm run build`
   - `Pre-Deploy Command`: `npx prisma db push`
   - `Start Command`: `npm run start:prod`

### Вариант через render.yaml

Можно использовать уже подготовленный файл [render.yaml](/Users/aknila/Desktop/touchspace-chat/render.yaml).

## 2. Какие env нужны для backend

Минимально обязательные:

```env
DATABASE_URL=postgresql://...
CORS_ORIGIN=https://<frontend-project>.vercel.app
ALLOW_VERCEL_PREVIEWS=true
PORT=3001
```

Для AI-функций:

```env
OPENAI_API_KEY=...
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_ADMIN_MODEL=gpt-5-mini
```

Для push потом:

```env
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:ops@touchspace.example
```

## 3. Что нужно сделать для frontend на Vercel

1. Зайти в Vercel
2. Нажать `Add New -> Project`
3. Подключить GitHub-репозиторий
4. Выбрать этот repo
5. В настройках проекта указать:
   - `Root Directory`: `frontend`
6. Framework Vercel определит как `Next.js`

### Build settings

Обычно достаточно defaults:

- Build Command: `npm run build`
- Output: автоматически

## 4. Какие env нужны для frontend

Минимум:

```env
NEXT_PUBLIC_API_BASE_URL=https://<backend-project>.onrender.com
NEXT_PUBLIC_APP_URL=https://<frontend-project>.vercel.app
```

Главная связка тут:

- frontend ходит в backend через `NEXT_PUBLIC_API_BASE_URL`
- backend пускает frontend через `CORS_ORIGIN`

## 5. Как связать frontend и backend

Нужно сделать обе стороны согласованными:

### На frontend в Vercel

```env
NEXT_PUBLIC_API_BASE_URL=https://<backend-project>.onrender.com
NEXT_PUBLIC_APP_URL=https://<frontend-project>.vercel.app
```

### На backend в Render

```env
CORS_ORIGIN=https://<frontend-project>.vercel.app
ALLOW_VERCEL_PREVIEWS=true
```

Если используете preview deployments Vercel, `ALLOW_VERCEL_PREVIEWS=true` позволит им тоже ходить в backend.

## 6. Порядок деплоя

Лучше идти именно так:

1. Сначала поднять backend на Render
2. Получить его URL `https://<backend>.onrender.com`
3. После этого задеплоить frontend на Vercel
4. Вставить backend URL в `NEXT_PUBLIC_API_BASE_URL`
5. Перезапустить frontend deploy, если env добавлялся после первого билда

## 7. Как проверить после деплоя

### Проверка backend

Открыть:

- `https://<backend>.onrender.com/push/public-key`

Если push ещё не настроен, endpoint всё равно должен отвечать JSON.

### Проверка frontend

Открыть:

- `https://<frontend>.vercel.app/login`

### Проверка ролей

Дальше пройти по ролям:

1. `admin`
   - логин
   - открыть `/admin`
   - проверить overview, users, analytics
2. `manager`
   - логин
   - открыть `/`
   - проверить входящие, claim, presence
3. `supplier`
   - логин
   - открыть `/supplier`
   - проверить supplier requests и переписку

### Проверка PWA

На Vercel-приложении:

1. открыть приложение в Chrome
2. залогиниться под внутренней ролью
3. убедиться, что виден install/push runtime block
4. попробовать установить приложение

Важно:

- PWA на `vercel.app` уже работает лучше, чем на localhost
- installability зависит от браузера

## 8. Как проверить админку, менеджера, поставщика и логин

Минимальный smoke test:

1. `login`
2. `admin -> /admin`
3. `manager -> /`
4. `supplier -> /supplier`
5. создать новый клиентский диалог
6. проверить, что он виден менеджерам
7. проверить claim
8. проверить AI handoff, если включён AI

## 9. Что нужно для push-уведомлений на следующем шаге

Для следующего шага понадобятся:

1. production VAPID keys
2. backend env:
   - `WEB_PUSH_PUBLIC_KEY`
   - `WEB_PUSH_PRIVATE_KEY`
   - `WEB_PUSH_SUBJECT`
3. frontend уже ничего дополнительно не требует, кроме корректного backend URL
4. HTTPS уже будет, так как Vercel и Render работают по HTTPS

После этого можно:

- включать notifications из UI
- тестировать test push
- проверять реальные уведомления по сообщениям

## 10. Что нужно прислать мне дальше

Чтобы перейти к следующему шагу без лишней переписки, от тебя нужны значения:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_API_BASE_URL` после создания Render backend
- `CORS_ORIGIN` после создания Vercel frontend
- позже:
  - `WEB_PUSH_PUBLIC_KEY`
  - `WEB_PUSH_PRIVATE_KEY`
  - `WEB_PUSH_SUBJECT`

## 11. Короткий порядок действий для тебя

1. Создать backend service на Render
2. Добавить backend env
3. Получить `onrender.com` URL
4. Создать frontend project на Vercel
5. Добавить frontend env
6. Открыть `vercel.app`
7. Проверить роли и экраны
8. Потом отдельно включить push

## 12. Что важно честно

Я подготовил проект под эту схему, но без доступа к вашим аккаунтам Render/Vercel я не могу сам нажать publish в этих сервисах.

Следующий самый практичный шаг:

1. ты создаёшь backend на Render
2. присылаешь мне:
   - Render URL
   - Vercel URL
   - список env, которые реально будешь использовать
3. я проверяю и говорю точные значения, что куда вставить
