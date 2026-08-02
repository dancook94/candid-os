#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  echo ""
  echo "Get the Postgres connection URI from Supabase Dashboard:"
  echo "  Project Settings → Database → Connection string → URI (Session pooler)"
  echo ""
  echo "Then run:"
  echo "  DATABASE_URL='postgresql://...' ./scripts/apply-jobs-migration.sh"
  exit 1
fi

echo "Applying jobs foundation migration via Supabase CLI..."
npx supabase db push --db-url "$DATABASE_URL" --yes

echo "Done. Reload the Supabase API schema cache if jobs still 404 briefly."
