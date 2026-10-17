#!/usr/bin/env bash
set -e

# Unified startup script for PostgreSQL environments
# Environment variables:
#   ENV_MODE: dev | test | ci | prod (default: dev)

ENV_MODE=${ENV_MODE:-dev}

echo "========================================"
echo "Starting application..."
echo "ENV_MODE: $ENV_MODE"
echo "========================================"

# Wait for PostgreSQL
echo "Waiting for PostgreSQL..."
/opt/wait-for-it.sh postgres:5432 -t 60

# Wait for mail service (not in prod)
if [ "$ENV_MODE" != "prod" ]; then
  echo "Waiting for mail service..."
  /opt/wait-for-it.sh maildev:1025 -t 30 || true
fi

# Wait for Redis if enabled
if [ -n "$REDIS_HOST" ] && [ "$REDIS_ENABLED" = "true" ]; then
  echo "Waiting for Redis..."
  /opt/wait-for-it.sh ${REDIS_HOST}:${REDIS_PORT:-6379} -t 30 || true
fi

# Install dependencies for test mode (source is mounted)
if [ "$ENV_MODE" = "test" ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

# Build for CI mode if not already built
if [ "$ENV_MODE" = "ci" ] && [ ! -d "dist" ]; then
  echo "Building application..."
  pnpm build
fi

# Run migrations
echo "Running database migrations..."
if [ "$ENV_MODE" = "prod" ]; then
  npm run migration:run:prod
else
  pnpm migration:run
fi

# Clear cached role permissions so permission migrations take effect immediately
echo "Clearing permission cache..."
if [ "$ENV_MODE" = "prod" ]; then
  npm run permissions:clear-cache:prod
else
  pnpm permissions:clear-cache
fi

# Run seed data
# In production: only run if RUN_SEEDS=true (for initial deployment)
# In other environments: always run
if [ "$ENV_MODE" = "prod" ]; then
  if [ "$RUN_SEEDS" = "true" ]; then
    echo "Running seed data in production (RUN_SEEDS=true)..."
    npm run seed:run:prod
  else
    echo "Skipping seed data in production mode (set RUN_SEEDS=true to enable)"
  fi
else
  echo "Running seed data..."
  pnpm seed:run:relational
fi

# Start application based on environment
case $ENV_MODE in
  dev)
    echo "Starting in development mode..."
    pnpm start:dev
    ;;
  test)
    echo "Starting in test mode..."
    pnpm start:dev
    ;;
  ci)
    echo "Starting in CI mode..."
    pnpm start:prod > /tmp/app.log 2>&1 &
    APP_PID=$!

    echo "Waiting for application to be ready..."
    if ! /opt/wait-for-it.sh localhost:3000 -t 120; then
      echo "========================================"
      echo "Application failed to start. Logs:"
      echo "========================================"
      cat /tmp/app.log || true
      exit 1
    fi

    echo "Running E2E tests..."
    pnpm test:e2e

    # Cleanup
    kill $APP_PID 2>/dev/null || true
    ;;
  prod|*)
    echo "Starting in production mode..."
    exec node --enable-source-maps dist/main
    ;;
esac
