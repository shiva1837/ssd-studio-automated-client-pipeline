# syntax=docker/dockerfile:1
# ----------------------------------------------------------
# Next.js 16 web frontend — multi-stage build.
# Build context is the monorepo root (see docker-compose.yml).
# ----------------------------------------------------------
FROM node:20-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
WORKDIR /repo/apps/web
RUN npm run build

FROM base AS runner
WORKDIR /repo/apps/web
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/package.json ./package.json
COPY --from=build /repo/node_modules /repo/node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
