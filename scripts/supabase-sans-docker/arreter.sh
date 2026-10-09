#!/usr/bin/env bash
# Arrête la pile Supabase locale sans Docker.
ICI="$(cd "$(dirname "$0")" && pwd)"
LOCAL="$(cd "$ICI/../.." && pwd)/.supabase-local"
for s in proxy auth postgrest; do
  if [ -f "$LOCAL/$s.pid" ]; then kill "$(cat "$LOCAL/$s.pid")" 2>/dev/null || true; rm -f "$LOCAL/$s.pid"; fi
done
