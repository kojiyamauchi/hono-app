#!/usr/bin/env bash
# AWSや外部DBへ接続せず、本番イメージとmigrationを使い捨てPostgreSQLで検証する。
set -euo pipefail

cd "$(dirname "$0")/.."
smoke_id="hono-app-smoke-$(date +%s)-$$"
smoke_dir="$(mktemp -d)"
runtime_image="${smoke_id}:runtime"
migration_image="${smoke_id}:migration"
database_url="postgresql://postgres:smoke-password@${smoke_id}-db:5432/postgres"

# 自分が作成したコンテナ・匿名ボリューム・ネットワーク・タグだけを削除する。
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    docker logs "${smoke_id}-app" 2>/dev/null || true
    # 診断にはエラーだけを出し、認証トークンを含む成功レスポンスは表示しない。
    bun -e '
    for (const name of ["signup", "login", "me", "refresh"]) {
      try {
        const value = await Bun.file(`${process.argv[1]}/${name}.json`).json();
        if (value.error) console.error(name, value.error);
      } catch {}
    }
    ' "$smoke_dir" || true
  fi
  docker rm -fv "${smoke_id}-app" "${smoke_id}-db" >/dev/null 2>&1 || true
  docker network rm "$smoke_id" >/dev/null 2>&1 || true
  docker image rm "$runtime_image" "$migration_image" >/dev/null 2>&1 || true
  rm -rf "$smoke_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker info >/dev/null
docker build --platform linux/amd64 --target runtime -t "$runtime_image" .
docker build --platform linux/amd64 --target migration -t "$migration_image" .

# 検証用の自己署名証明書は一時生成し、公開CAの同梱と証明書検証の維持を確認する。
mkdir "$smoke_dir/tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost' \
  -keyout "$smoke_dir/tls/server.key" -out "$smoke_dir/tls/server.crt" >/dev/null 2>&1
# コンテナ内の非rootユーザーが、使い捨ての検証用秘密鍵を読み取れるようにする。
chmod 755 "$smoke_dir/tls"
chmod 644 "$smoke_dir/tls/server.key"
for image in "$runtime_image" "$migration_image"; do
  docker run --rm --platform linux/amd64 \
    --mount "type=bind,source=$smoke_dir/tls,target=/tmp/container-tls,readonly" \
    --mount "type=bind,source=$PWD/scripts/verify-container-tls.mjs,target=/app/verify-container-tls.mjs,readonly" \
    "$image" bun /app/verify-container-tls.mjs /tmp/container-tls
done

docker network create "$smoke_id" >/dev/null
docker run -d --name "${smoke_id}-db" --network "$smoke_id" \
  -e POSTGRES_PASSWORD=smoke-password postgres:17-alpine >/dev/null

database_ready=false
for _ in {1..60}; do
  if docker exec "${smoke_id}-db" pg_isready -U postgres >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done
[ "$database_ready" = true ] || { echo '検証用DBの起動がタイムアウトしました。' >&2; exit 1; }

# 2回実行し、初回適用と再実行時の冪等性を確認する。
docker run --rm --platform linux/amd64 --network "$smoke_id" -e "DATABASE_URL=$database_url" "$migration_image"
docker run --rm --platform linux/amd64 --network "$smoke_id" -e "DATABASE_URL=$database_url" "$migration_image"

# メール送信キーを渡さず、外部サービスへの実配達を発生させない。
docker run -d --platform linux/amd64 --name "${smoke_id}-app" --network "$smoke_id" \
  --memory=512m --cpus=0.25 -p 127.0.0.1::3000 \
  -e "DATABASE_URL=$database_url" \
  -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_ANON_KEY=smoke-key \
  -e JWT_SECRET=smoke-jwt-secret -e REFRESH_TOKEN_SECRET=smoke-refresh-secret \
  -e PASSWORD_RESET_TOKEN_SECRET=smoke-password-reset-secret \
  -e EMAIL_VERIFICATION_TOKEN_SECRET=smoke-email-secret \
  -e COOKIE_SECURE=false -e ENABLE_API_DOCS=false -e OTEL_TRACES_ENABLED=false \
  -e ALLOWED_ORIGINS=http://localhost:3000 "$runtime_image" >/dev/null
app_port="$(docker port "${smoke_id}-app" 3000/tcp | sed 's/.*://')"
base_url="http://127.0.0.1:${app_port}"

application_ready=false
for _ in {1..90}; do
  if curl --fail --silent --max-time 2 "$base_url/health" > "$smoke_dir/health.json"; then
    application_ready=true
    break
  fi
  sleep 1
done
[ "$application_ready" = true ] || { echo 'アプリの起動がタイムアウトしました。' >&2; exit 1; }

curl --fail-with-body --silent --show-error --max-time 30 -c "$smoke_dir/cookies" \
  -H 'Content-Type: application/json' \
  -d '{"name":"公開前検証","email":"smoke@example.com","password":"smoke-password-123"}' \
  "$base_url/auth/signup" > "$smoke_dir/signup.json"
curl --fail-with-body --silent --show-error --max-time 30 \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com","password":"smoke-password-123"}' \
  "$base_url/auth/login" > "$smoke_dir/login.json"
token="$(bun -e 'const value = await Bun.file(process.argv[1]).json(); if (!value.token) process.exit(1); console.info(value.token)' "$smoke_dir/login.json")"
curl --fail-with-body --silent --show-error --max-time 30 -H "Authorization: Bearer $token" \
  "$base_url/auth/me" > "$smoke_dir/me.json"
curl --fail-with-body --silent --show-error --max-time 30 -b "$smoke_dir/cookies" \
  -X POST "$base_url/auth/refresh" > "$smoke_dir/refresh.json"

bun -e '
const directory = process.argv[1];
const health = await Bun.file(`${directory}/health.json`).json();
const me = await Bun.file(`${directory}/me.json`).json();
const refresh = await Bun.file(`${directory}/refresh.json`).json();
if (health.ok !== true || me.email !== "smoke@example.com" || !refresh.token) process.exit(1);
' "$smoke_dir"
[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/open-api/doc")" = 404 ]
[ "$(docker inspect --format '{{.Config.User}}' "${smoke_id}-app")" = bun ]
echo 'コンテナ検証成功: migration初回・再実行、512 MB起動、health、登録・ログイン・本人取得・refresh、APIドキュメント非公開、非root実行。'
