# Server install script

Для переноса на новый Ubuntu-сервер добавлен установочный скрипт:

```text
scripts/install-server.sh
```

Скрипт рассчитан на запуск из корня проекта на новом сервере. Он:

- проверяет, что запуск идёт из корня репозитория;
- устанавливает Docker и Docker Compose plugin, если их нет;
- создаёт `.env` и `backend/.env` из example-файлов;
- прописывает домены frontend/backend;
- генерирует MySQL-пароли, если они не заданы заранее;
- создаёт папки `backend/uploads`, `deploy/downloads`, `backups`;
- собирает и запускает `mysql`, `backend`, `frontend` через `docker-compose.prod.yml`;
- опционально создаёт начального администратора `admin / admin123`;
- опционально ставит Nginx и создаёт базовый reverse proxy config.

## Базовый запуск

```bash
APP_DOMAIN=app.example.ru \
API_DOMAIN=api.example.ru \
./scripts/install-server.sh
```

Можно передавать домены сразу с `https://`:

```bash
APP_DOMAIN=https://app.example.ru \
API_DOMAIN=https://api.example.ru \
./scripts/install-server.sh
```

## Запуск с созданием администратора

Для новой пустой установки:

```bash
APP_DOMAIN=app.example.ru \
API_DOMAIN=api.example.ru \
INIT_ADMIN=1 \
ADMIN_LOGIN=admin \
ADMIN_PASSWORD=admin123 \
./scripts/install-server.sh
```

После этого вход:

```text
login: admin
password: admin123
```

Важно: создание администратора использует существующий backend-скрипт `reset-local-workspace`. Он очищает чаты, запросы поставщикам, регистрации, push-подписки и всех пользователей, кроме администратора. Использовать только для новой пустой установки.

## Запуск с Nginx

Если нужно, чтобы скрипт поставил Nginx и создал HTTP reverse proxy:

```bash
APP_DOMAIN=app.example.ru \
API_DOMAIN=api.example.ru \
INSTALL_NGINX=1 \
./scripts/install-server.sh
```

После этого нужно отдельно настроить SSL, например через certbot:

```bash
sudo certbot --nginx -d app.example.ru -d api.example.ru
```

## Переменные

Обязательные:

```text
APP_DOMAIN - домен frontend
API_DOMAIN - домен backend API
```

Опциональные:

```text
INSTALL_NGINX=1       - установить/настроить Nginx
INIT_ADMIN=1          - создать начального администратора
ADMIN_LOGIN=admin
ADMIN_PASSWORD=admin123
MYSQL_ROOT_PASSWORD=...
MYSQL_DATABASE=touchspace
MYSQL_USER=touchspace
MYSQL_PASSWORD=...
```

## Что проверить после установки

```bash
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f backend
sudo docker compose -f docker-compose.prod.yml logs -f frontend
```

Проверить в браузере:

```text
https://app.example.ru/login
https://api.example.ru
```

Если `INIT_ADMIN=1`, проверить вход:

```text
admin / admin123
```
