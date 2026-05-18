#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="touchspace-chat"
COMPOSE_FILE="docker-compose.prod.yml"

log() {
  printf '\n[%s] %s\n' "$APP_NAME" "$*"
}

die() {
  printf '\n[%s] ERROR: %s\n' "$APP_NAME" "$*" >&2
  exit 1
}

require_repo_root() {
  [[ -f "$COMPOSE_FILE" ]] || die "Run this script from the repository root."
  [[ -d "backend" && -d "frontend" ]] || die "backend/ and frontend/ directories are required."
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die "This installer is intended for a Linux server."
}

require_root_or_sudo() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then
    die "Run as root or install sudo."
  fi
}

run_as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n' | tr '/+' 'Aa' | cut -c1-32
  else
    date +%s%N | sha256sum | cut -c1-32
  fi
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped

  escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')

  if grep -qE "^${key}=" "$file"; then
    sed -i.bak -E "s/^${key}=.*/${key}=${escaped}/" "$file"
  elif grep -qE "^${key}=\"" "$file"; then
    sed -i.bak -E "s/^${key}=\".*\"/${key}=\"${escaped}\"/" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

normalize_domain_url() {
  local value="$1"
  [[ -n "$value" ]] || return 0

  if [[ "$value" =~ ^https?:// ]]; then
    printf '%s' "${value%/}"
  else
    printf 'https://%s' "${value%/}"
  fi
}

url_host() {
  local value="$1"
  value="${value#https://}"
  value="${value#http://}"
  printf '%s' "${value%/}"
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Docker Compose are already installed."
    return
  fi

  log "Installing Docker and Docker Compose plugin."
  run_as_root apt-get update
  run_as_root apt-get install -y ca-certificates curl gnupg
  run_as_root install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | run_as_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_as_root chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local codename
  codename=$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-}")
  [[ -n "$codename" ]] || die "Could not detect Ubuntu codename."

  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$codename" \
    | run_as_root tee /etc/apt/sources.list.d/docker.list >/dev/null

  run_as_root apt-get update
  run_as_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

prepare_env_files() {
  local app_url="$1"
  local api_url="$2"
  local mysql_root_password="${MYSQL_ROOT_PASSWORD:-$(generate_secret)}"
  local mysql_password="${MYSQL_PASSWORD:-$(generate_secret)}"
  local mysql_database="${MYSQL_DATABASE:-touchspace}"
  local mysql_user="${MYSQL_USER:-touchspace}"
  local database_url

  database_url="mysql://${mysql_user}:${mysql_password}@mysql:3306/${mysql_database}?allowPublicKeyRetrieval=true"

  [[ -f ".env" ]] || cp .env.example .env
  [[ -f "backend/.env" ]] || cp backend/.env.example backend/.env

  set_env_value ".env" "MYSQL_ROOT_PASSWORD" "$mysql_root_password"
  set_env_value ".env" "MYSQL_DATABASE" "$mysql_database"
  set_env_value ".env" "MYSQL_USER" "$mysql_user"
  set_env_value ".env" "MYSQL_PASSWORD" "$mysql_password"
  set_env_value ".env" "DATABASE_HOST" "mysql"
  set_env_value ".env" "DATABASE_PORT" "3306"
  set_env_value ".env" "DATABASE_USER" "$mysql_user"
  set_env_value ".env" "DATABASE_PASSWORD" "$mysql_password"
  set_env_value ".env" "DATABASE_NAME" "$mysql_database"
  set_env_value ".env" "DATABASE_URL" "$database_url"
  set_env_value ".env" "NEXT_PUBLIC_API_BASE_URL" "$api_url"
  set_env_value ".env" "NEXT_PUBLIC_APP_URL" "$app_url"

  set_env_value "backend/.env" "DATABASE_URL" "\"${database_url}\""
  set_env_value "backend/.env" "DATABASE_HOST" "\"mysql\""
  set_env_value "backend/.env" "DATABASE_PORT" "\"3306\""
  set_env_value "backend/.env" "DATABASE_USER" "\"${mysql_user}\""
  set_env_value "backend/.env" "DATABASE_PASSWORD" "\"${mysql_password}\""
  set_env_value "backend/.env" "DATABASE_NAME" "\"${mysql_database}\""
  set_env_value "backend/.env" "CORS_ORIGIN" "\"${app_url}\""
  set_env_value "backend/.env" "PORT" "3001"
  set_env_value "backend/.env" "WEB_PUSH_SUBJECT" "\"mailto:ops@$(url_host "$app_url")\""

  rm -f .env.bak backend/.env.bak
}

prepare_directories() {
  mkdir -p backend/uploads deploy/downloads backups
}

write_nginx_config() {
  local app_url="$1"
  local api_url="$2"
  local app_host
  local api_host
  app_host="$(url_host "$app_url")"
  api_host="$(url_host "$api_url")"
  local nginx_file="/etc/nginx/sites-available/touchspace-chat.conf"

  log "Writing Nginx config to $nginx_file."
  run_as_root tee "$nginx_file" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${app_host};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name ${api_host};

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  run_as_root ln -sf "$nginx_file" /etc/nginx/sites-enabled/touchspace-chat.conf
  run_as_root nginx -t
  run_as_root systemctl reload nginx
}

install_nginx_if_requested() {
  local app_url="$1"
  local api_url="$2"

  if [[ "${INSTALL_NGINX:-0}" != "1" ]]; then
    return
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "Installing Nginx."
    run_as_root apt-get update
    run_as_root apt-get install -y nginx
  fi

  write_nginx_config "$app_url" "$api_url"

  log "Nginx is configured for HTTP. Configure SSL with certbot or another certificate manager."
}

start_application() {
  log "Building and starting Docker Compose services."
  run_as_root docker compose -f "$COMPOSE_FILE" up -d --build
}

wait_for_backend() {
  log "Waiting for backend container."

  local attempt
  for attempt in $(seq 1 60); do
    if run_as_root docker compose -f "$COMPOSE_FILE" exec -T backend sh -lc 'test -f dist/src/main.js' >/dev/null 2>&1; then
      return
    fi

    sleep 2
  done

  die "Backend container did not become ready in time. Check: sudo docker compose -f ${COMPOSE_FILE} logs backend"
}

reset_admin_if_requested() {
  if [[ "${INIT_ADMIN:-0}" != "1" ]]; then
    return
  fi

  local admin_login="${ADMIN_LOGIN:-admin}"
  local admin_password="${ADMIN_PASSWORD:-admin123}"

  log "Creating/resetting initial admin account. This is safe only for a new empty installation."
  wait_for_backend
  run_as_root docker compose -f "$COMPOSE_FILE" exec -T backend sh -lc \
    "RESET_LOCAL_DATA_CONFIRM=touchspace-local-reset RESET_ADMIN_LOGIN='${admin_login}' RESET_ADMIN_PASSWORD='${admin_password}' node dist/src/scripts/reset-local-workspace.js"
}

print_summary() {
  local app_url="$1"
  local api_url="$2"

  cat <<SUMMARY

[$APP_NAME] Installation command completed.

Frontend:
  ${app_url}

Backend API:
  ${api_url}

Local container ports:
  frontend: http://127.0.0.1:3000
  backend:  http://127.0.0.1:3001
  mysql:    127.0.0.1:3306

Important files:
  .env
  backend/.env
  docker-compose.prod.yml
  backend/uploads

If INIT_ADMIN=1 was used:
  login:    ${ADMIN_LOGIN:-admin}
  password: ${ADMIN_PASSWORD:-admin123}

Next checks:
  sudo docker compose -f docker-compose.prod.yml ps
  sudo docker compose -f docker-compose.prod.yml logs -f backend
  sudo docker compose -f docker-compose.prod.yml logs -f frontend

SUMMARY
}

main() {
  require_repo_root
  require_linux
  require_root_or_sudo

  local app_url
  local api_url
  app_url="$(normalize_domain_url "${APP_DOMAIN:-${NEXT_PUBLIC_APP_URL:-}}")"
  api_url="$(normalize_domain_url "${API_DOMAIN:-${NEXT_PUBLIC_API_BASE_URL:-}}")"

  [[ -n "$app_url" ]] || die "Set APP_DOMAIN, for example: APP_DOMAIN=app.example.ru"
  [[ -n "$api_url" ]] || die "Set API_DOMAIN, for example: API_DOMAIN=api.example.ru"

  install_docker_if_needed
  prepare_directories
  prepare_env_files "$app_url" "$api_url"
  start_application
  reset_admin_if_requested
  install_nginx_if_requested "$app_url" "$api_url"
  print_summary "$app_url" "$api_url"
}

main "$@"
