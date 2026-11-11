# Unified Dockerfile for all environments
# Build args:
#   ENV_MODE: dev | test | ci | prod
#
# Example usage:
#   docker build --build-arg ENV_MODE=dev --target development -t app:dev .
#   docker build --target production -t app:prod .

# ============================================================
# Stage 1: Base - Install dependencies
# ============================================================
FROM node:24.22.2-alpine AS base

RUN apk add --no-cache bash
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ============================================================
# Stage 2: Dependencies - Install all dependencies
# ============================================================
FROM base AS deps

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 3: Builder - Build the application
# ============================================================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN cp env-example-relational .env

# Build the application
RUN pnpm run build

# ============================================================
# Stage 4: Production dependencies only
# ============================================================
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies (ignore scripts to skip husky)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ============================================================
# Stage 5: Production - Final minimal image
# ============================================================
FROM node:24.22.2-alpine AS production

ENV NODE_ENV=production
ENV ENV_MODE=prod

RUN apk add --no-cache bash

WORKDIR /app

# Copy only necessary files for production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy utility scripts
COPY scripts/wait-for-it.sh /opt/wait-for-it.sh
COPY scripts/startup.sh /opt/startup.sh
RUN chmod +x /opt/wait-for-it.sh /opt/startup.sh
RUN sed -i 's/\r//g' /opt/wait-for-it.sh /opt/startup.sh

# Create files directory with proper permissions for node user
RUN mkdir -p /app/files && chown -R node:node /app/files

EXPOSE 3000

USER node

CMD ["/opt/startup.sh"]

# ============================================================
# Stage 6: Development - Full development environment
# ============================================================
FROM base AS development

ARG ENV_MODE=dev

ENV ENV_MODE=${ENV_MODE}
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN cp env-example-relational .env

# Copy utility scripts
COPY scripts/wait-for-it.sh /opt/wait-for-it.sh
COPY scripts/startup.sh /opt/startup.sh
RUN chmod +x /opt/wait-for-it.sh /opt/startup.sh
RUN sed -i 's/\r//g' /opt/wait-for-it.sh /opt/startup.sh

# Build for non-test modes
RUN if [ "$ENV_MODE" != "test" ] && [ "$ENV_MODE" != "dev" ]; then \
      pnpm run build; \
    fi

EXPOSE 3000

CMD ["/opt/startup.sh"]
