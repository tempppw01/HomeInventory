#!/bin/sh
set -eu

if [ "${DATABASE_PROVIDER:-sqlite}" = "mysql" ]; then
  cp /app/prisma/schema.mysql.prisma /app/prisma/schema.prisma
  echo "Using MySQL database"
else
  echo "Using SQLite database"
fi

npx prisma generate --schema /app/prisma/schema.prisma

if [ "${DATABASE_PROVIDER:-sqlite}" = "mysql" ]; then
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

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  npx tsx /app/prisma/seed.ts
fi

exec npm start
