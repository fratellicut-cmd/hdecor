#!/usr/bin/env bash
# =============================================================================
# Sauvegarde COMPLÉMENTAIRE chiffrée (en plus des sauvegardes de l'hébergeur) :
# base (pg_dump) + fichiers référencés par la base (PDF émis, signatures,
# justificatifs, photos, logo), dans UNE archive chiffrée (AES-256, clé dérivée
# de la phrase secrète par PBKDF2).
#
#   DB_URL=postgres://… SAUVEGARDE_PHRASE=… bash scripts/sauvegarde/sauvegarder.sh [dossier]
#
# Variables : DB_URL (connexion directe à la base), NEXT_PUBLIC_SUPABASE_URL et
# SUPABASE_SERVICE_ROLE_KEY (lecture des fichiers), SAUVEGARDE_PHRASE (16
# caractères au moins ; jamais en argument, jamais dans git ; SANS elle,
# l'archive est irrécupérable : la garder hors du téléphone et de l'ordinateur).
# SAUVEGARDE_CONSERVATION_JOURS : les archives plus anciennes du dossier sont
# supprimées (365 jours par défaut, durée À VÉRIFIER, registre des traitements).
# Mot de passe de la base : de préférence dans ~/.pgpass (pas dans DB_URL, qui
# serait visible dans la liste des processus).
# =============================================================================
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
: "${DB_URL:?DB_URL manquante}"
: "${SAUVEGARDE_PHRASE:?SAUVEGARDE_PHRASE manquante}"
[ "${#SAUVEGARDE_PHRASE}" -ge 16 ] || { echo "SAUVEGARDE_PHRASE : 16 caractères au moins." >&2; exit 1; }
SORTIE="${1:-sauvegardes}"
mkdir -p "$SORTIE"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

echo "Base…"
pg_dump --format=custom --no-password -d "$DB_URL" -f "$TRAVAIL/base.dump"
echo "Liste des fichiers…"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB_URL" -f "$ICI/fichiers.sql" > "$TRAVAIL/fichiers.csv"
echo "Fichiers…"
node "$ICI/fichiers.mjs" exporter "$TRAVAIL/fichiers.csv" "$TRAVAIL/fichiers"
node "$ICI/fichiers.mjs" verifier "$TRAVAIL/fichiers.csv" "$TRAVAIL/fichiers"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$TRAVAIL/date.txt"

NOM="hdecor-$(date -u +%Y%m%d-%H%M%S).tar.gz.enc"
tar -C "$TRAVAIL" -czf - base.dump fichiers.csv date.txt fichiers \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:SAUVEGARDE_PHRASE -out "$SORTIE/$NOM"
echo "Sauvegarde chiffrée : $SORTIE/$NOM ($(du -h "$SORTIE/$NOM" | cut -f1))."

# Rotation : jamais de conservation sans fin (chaque archive contient des données personnelles).
JOURS="${SAUVEGARDE_CONSERVATION_JOURS:-365}"
[[ "$JOURS" =~ ^[0-9]+$ ]] && [ "$JOURS" -ge 7 ] || { echo "SAUVEGARDE_CONSERVATION_JOURS : nombre de jours (7 au moins)." >&2; exit 1; }
find "$SORTIE" -maxdepth 1 -type f -name 'hdecor-*.tar.gz.enc' -mtime +"$JOURS" -print -delete | sed 's/^/Archive ancienne supprimée : /'
