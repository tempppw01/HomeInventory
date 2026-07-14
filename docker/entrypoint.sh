#!/bin/sh
set -eu

DATABASE_PROVIDER="${DATABASE_PROVIDER:-sqlite}"
export DATABASE_PROVIDER

if [ "$DATABASE_PROVIDER" = "mysql" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required when DATABASE_PROVIDER=mysql" >&2
    exit 1
  fi
  cp /app/prisma/schema.mysql.prisma /app/prisma/schema.prisma
  echo "Using MySQL database"
else
  DATABASE_URL="${DATABASE_URL:-file:/app/data/home-inventory.db}"
  export DATABASE_URL
  mkdir -p /app/data
  echo "Using SQLite database"
fi

npx prisma generate --schema /app/prisma/schema.prisma

if [ "$DATABASE_PROVIDER" = "mysql" ]; then
  attempt=1
  until npx prisma db push --schema /app/prisma/schema.prisma --skip-generate; do
    if [ "$attempt" -ge 12 ]; then
      echo "Database initialization failed after $attempt attempts"
      exit 1
    fi
    echo "Database is not ready, retrying in 5 seconds ($attempt/12)..."
    attempt=$((attempt + 1))
    sleep 5
  done
else
  npx tsx /app/scripts/init-sqlite.ts
fi

case "${SEED_DEMO_DATA:-auto}" in
  false|0|no|off) echo "Demo data disabled" ;;
  *) npx tsx /app/prisma/seed.ts ;;
esac

npx tsx /app/scripts/backfill-item-codes.ts

exec npm start
