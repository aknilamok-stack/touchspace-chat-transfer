# Transfer handoff checklist

This repository is a clean transfer copy of TouchSpace Chat.

## Important

- Do not use the previous owner's production server, domains, database, or uploads.
- Configure a new server, new domains, new database, new `.env` files, and new secrets.
- Real `.env` files, local database files, uploads, build artifacts, and packaged desktop builds are intentionally not included.

## Recommended domain scheme

```text
app.example.ru  - frontend
api.example.ru  - backend
```

Update:

```text
NEXT_PUBLIC_API_BASE_URL=https://api.example.ru
NEXT_PUBLIC_APP_URL=https://app.example.ru
CORS_ORIGIN=https://app.example.ru
DESKTOP_START_URL=https://app.example.ru/login
DATABASE_URL=mysql://...
```

Main places to check:

```text
.env.example
frontend/.env.example
backend/.env.example
docker-compose.prod.yml
frontend/lib/api.ts
backend/src/main.ts
desktop/src/main.js
desktop/package.json
```

## Initial admin account

The login page authenticates through the backend endpoint:

```text
POST /auth/login
```

So a fresh database needs an admin profile before `admin / admin123` can work.

For a new empty/local Docker deployment, create/reset the initial admin with:

```bash
cd backend
RESET_LOCAL_DATA_CONFIRM=touchspace-local-reset \
RESET_ADMIN_LOGIN=admin \
RESET_ADMIN_PASSWORD=admin123 \
npm run reset:local-workspace
```

Expected credentials:

```text
login: admin
password: admin123
```

Warning: `reset:local-workspace` deletes chats, supplier requests, registrations, push subscriptions, and non-admin users. Use it only for a new empty installation or a disposable local environment.

The script refuses to run against non-local database hosts. Allowed DB hosts are:

```text
localhost
127.0.0.1
mysql
```

For an existing production database, create or update the admin account through a controlled migration/admin procedure instead of running the reset script.

## Basic acceptance check

After deployment verify:

```text
1. Frontend opens on the new domain.
2. Backend health/API is reachable on the new API domain.
3. Login works with admin / admin123.
4. Admin panel opens.
5. A client can create a chat.
6. A manager can see and answer the chat.
7. Attachments upload and remain after restart.
8. Supplier request flow works.
9. Backups are configured for MySQL and uploads.
```
