FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:../data/build.db"
RUN npx prisma generate --schema prisma/schema.prisma && npm run build

FROM node:22-alpine AS init-tools
WORKDIR /app
# The startup migration scripts only need Prisma CLI and tsx. Installing this
# tiny toolchain separately avoids bringing the whole application dependency
# tree into the runtime image a second time.
RUN npm install --omit=dev --ignore-scripts --no-package-lock prisma@6.19.3 tsx@4.23.1 && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN apk add --no-cache curl
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=init-tools /app/node_modules ./init-node_modules
COPY docker/entrypoint.sh /usr/local/bin/home-inventory-entrypoint
RUN chmod +x /usr/local/bin/home-inventory-entrypoint && mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
ENTRYPOINT ["home-inventory-entrypoint"]
