#!/usr/bin/env bash
# =============================================================================
# Pile Supabase locale SANS Docker (développement et tests de bout en bout).
#
# Sur un poste avec Docker, préférez la CLI officielle : `npx supabase start`
# (configuration dans supabase/config.toml). Ce script sert aux environnements
# où Docker est indisponible : PostgreSQL 16 local + GoTrue (auth) + PostgREST
# (API) + une mini passerelle qui reproduit les chemins /auth/v1 et /rest/v1.
# Le stockage de fichiers est émulé par la passerelle (disque, clé service seulement).
#
#   bash scripts/supabase-sans-docker/demarrer.sh          # (re)crée tout
#   bash scripts/supabase-sans-docker/arreter.sh
#
# Écrit .env.local (URL et clés de DÉVELOPPEMENT, jamais de production).
# =============================================================================
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
LOCAL="$RACINE/.supabase-local"
DB=${DB:-hdecor_dev}
PORT_API=${PORT_API:-54321}
PORT_REST=${PORT_REST:-54331}
PORT_AUTH=${PORT_AUTH:-54332}
# Secret de développement uniquement (32+ caractères), sans valeur en production.
JWT_SECRET=${JWT_SECRET:-secret-de-developpement-local-hdecor-0123456789}
SITE_URL=${SITE_URL:-http://localhost:3000}

GOTRUE_VERSION=2.180.0
POSTGREST_VERSION=12.2.12

mkdir -p "$LOCAL/bin" "$LOCAL/logs"
if [ ! -x "$LOCAL/bin/auth" ]; then
  echo "Téléchargement de GoTrue $GOTRUE_VERSION…"
  curl -fsSL "https://github.com/supabase/auth/releases/download/v$GOTRUE_VERSION/auth-v$GOTRUE_VERSION-x86.tar.gz" \
    | tar xz -C "$LOCAL/bin"
fi
if [ ! -x "$LOCAL/bin/postgrest" ]; then
  echo "Téléchargement de PostgREST $POSTGREST_VERSION…"
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/v$POSTGREST_VERSION/postgrest-v$POSTGREST_VERSION-linux-static-x86-64.tar.xz" \
    | tar xJ -C "$LOCAL/bin"
fi

bash "$ICI/arreter.sh" >/dev/null 2>&1 || true

echo "Base $DB : création…"
psql -q -X -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$ICI/base_supabase.sql" -o /dev/null

echo "GoTrue : migrations du schéma auth…"
export GOTRUE_DB_DRIVER=postgres
export DATABASE_URL="postgres://supabase_auth_admin:auth-admin-dev@127.0.0.1:5432/$DB?search_path=auth"
export GOTRUE_DB_MIGRATIONS_PATH="$LOCAL/bin/migrations"
export GOTRUE_API_HOST=127.0.0.1
export PORT=$PORT_AUTH
export API_EXTERNAL_URL="http://127.0.0.1:$PORT_API/auth/v1"
export GOTRUE_SITE_URL="$SITE_URL"
export GOTRUE_URI_ALLOW_LIST="$SITE_URL/auth/confirmer**"
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES=service_role
# Comme en production : inscription publique FERMÉE.
export GOTRUE_DISABLE_SIGNUP=true
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_MAILER_AUTOCONFIRM=false
export GOTRUE_PASSWORD_MIN_LENGTH=12
export GOTRUE_MFA_TOTP_ENROLL_ENABLED=true
export GOTRUE_MFA_TOTP_VERIFY_ENABLED=true
export GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
# Mêmes règles que supabase/config.toml (production) :
export GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true
export GOTRUE_MAILER_OTP_EXP=900
# Courriels : pas de serveur SMTP local ; les liens sont générés par l'API
# d'administration dans les tests (generate_link).
export GOTRUE_SMTP_HOST=127.0.0.1
export GOTRUE_SMTP_PORT=2500
export GOTRUE_SMTP_ADMIN_EMAIL=no-reply@hdecor.local
export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
"$LOCAL/bin/auth" migrate > "$LOCAL/logs/auth-migrate.log" 2>&1

echo "Migrations H'DECOR…"
for f in "$RACINE"/supabase/migrations/*.sql; do
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$f" -o /dev/null
done

echo "PostgREST…"
cat > "$LOCAL/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator-dev@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PORT_REST
CONF
nohup "$LOCAL/bin/postgrest" "$LOCAL/postgrest.conf" > "$LOCAL/logs/postgrest.log" 2>&1 &
echo $! > "$LOCAL/postgrest.pid"

echo "GoTrue…"
nohup "$LOCAL/bin/auth" serve > "$LOCAL/logs/auth.log" 2>&1 &
echo $! > "$LOCAL/auth.pid"

eval "$(node "$ICI/cles.mjs" "$JWT_SECRET")"

echo "Passerelle (et stockage de fichiers émulé sur le disque)…"
mkdir -p "$LOCAL/stockage"
PORT_API=$PORT_API PORT_REST=$PORT_REST PORT_AUTH=$PORT_AUTH DOSSIER_STOCKAGE="$LOCAL/stockage" CLE_SERVICE="$SERVICE" \
  nohup node "$ICI/proxy.mjs" > "$LOCAL/logs/proxy.log" 2>&1 &
echo $! > "$LOCAL/proxy.pid"
cat > "$RACINE/.env.local" <<ENVF
# Généré par scripts/supabase-sans-docker/demarrer.sh : DÉVELOPPEMENT LOCAL UNIQUEMENT.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PORT_API
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=$SITE_URL
CRON_SECRET=$(openssl rand -hex 32)
# Webhook Stripe : secret local ALÉATOIRE pour les tests (aucun compte Stripe, aucun paiement réel).
STRIPE_WEBHOOK_SECRET=whsec_local_$(openssl rand -hex 24)
ENVF

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT_API/auth/v1/health" >/dev/null 2>&1 \
     && curl -fsS -H "apikey: $ANON" "http://127.0.0.1:$PORT_API/rest/v1/" >/dev/null 2>&1; then
    echo "Pile prête : http://127.0.0.1:$PORT_API (base $DB). Clés écrites dans .env.local."
    exit 0
  fi
  sleep 1
done
echo "La pile n'a pas démarré : voir $LOCAL/logs/" >&2
exit 1
