# syntax=docker/dockerfile:1
# ----------------------------------------------------------
# Express API — multi-stage build.
# Build context is the monorepo root (see docker-compose.yml) so the
# Prisma schema in packages/db is available for client generation.
# ----------------------------------------------------------
FROM node:20-alpine AS base
RUN apk add --no-cache openssl wget

FROM base AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm install

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
# Generate the Prisma client, then compile TypeScript.
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma
WORKDIR /repo/apps/api
RUN npm run build

FROM base AS runner
WORKDIR /repo/apps/api
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/packages/db/prisma /repo/packages/db/prisma
EXPOSE 4000
# Apply pending migrations on boot, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=/repo/packages/db/prisma/schema.prisma && node dist/index.js"]
