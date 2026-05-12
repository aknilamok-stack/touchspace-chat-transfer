# TouchSpace Desktop App MVP

## Что это

Desktop App для TouchSpace делается как отдельная Electron-оболочка поверх уже работающего frontend и backend.

Это не вторая продуктовая система и не новый UI. Desktop-приложение открывает тот же TouchSpace Workspace, но в отдельном скачиваемом окне приложения.

## Как работает MVP

1. Пользователь скачивает TouchSpace Workspace для macOS или Windows.
2. Приложение открывает внутренний TouchSpace по удалённому URL.
3. Логин, роли, админка, менеджерский интерфейс, поставщик, AI и аналитика работают через тот же backend.
4. Окно приложения живёт отдельно от браузера и ощущается как desktop app.

## Архитектура

- `backend/` остаётся серверной частью на Render
- `frontend/` остаётся основным UI на Vercel
- `desktop/` добавляет Electron shell

Desktop shell:
- открывает `DESKTOP_START_URL`, если он передан через env
- иначе открывает production URL TouchSpace на Vercel
- запрещает внутренним webview открывать сторонние сайты
- внешние ссылки уводит в системный браузер

## Что добавлено в desktop shell

- отдельная папка `desktop/`
- `desktop/src/main.js` — Electron main process
- `desktop/src/preload.js` — безопасный bridge между desktop shell и UI
- `desktop/package.json` — scripts и конфиг packaging

## Что добавлено во frontend

Frontend теперь умеет понять, что он открыт:
- как PWA в браузере
- как обычная вкладка
- как настоящее desktop-приложение через Electron

Из-за этого:
- в desktop-режиме не показывается лишняя кнопка PWA-установки
- на `/settings` видно, что TouchSpace уже запущен как desktop app

## Скрипты desktop

В папке `desktop/`:

- `npm run dev`
  - запускает Electron против production URL
- `npm run dev:local`
  - запускает Electron против локального `http://localhost:3000/login`
- `npm run package:dir`
  - собирает unpacked desktop build
- `npm run package:mac`
  - пытается собрать `.dmg` для macOS
- `npm run package:mac:zip`
  - собирает `.zip` для macOS как безопасный MVP-артефакт без DMG-зависимостей среды
- `npm run package:win`
  - собирает Windows installer

## Что нужно для реальной сборки

В `desktop/` нужно установить зависимости:

- `electron`
- `electron-builder`

После этого можно собирать артефакты и раздавать `.zip`, `.dmg` или `.exe`.

## Ограничения MVP

- desktop app пока использует удалённый frontend URL, а не вшитый локальный frontend bundle
- автообновления desktop-клиента пока не настроены
- нативное меню/иконки/tray доведены только до базового уровня
- для финального брендированного релиза нужны настоящие desktop icons (`.icns`, `.ico`)
- на некоторых macOS-окружениях `.dmg` может требовать локальные системные библиотеки; в MVP безопаснее раздавать `.zip`
- push и web notifications продолжают жить через существующий web-слой; отдельный native notification center можно усилить на следующем этапе

## Следующий этап

1. Установить desktop dependencies
2. Собрать первый macOS `.dmg`
3. Проверить login / role routing / deep links
4. Добавить branded icons и release process
5. При необходимости настроить auto-update
