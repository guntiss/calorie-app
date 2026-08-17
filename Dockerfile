# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Runs `nuxt dev` against the checked-out source instead of a production
# build, so import.meta.dev-gated routes (e.g. server/routes/auth/dev.get.ts)
# work. Used by the separate cal-g4-lv-dev deployment, not the production one.
FROM base AS dev
ENV NODE_ENV=development
# HOST/PORT (not `nuxt dev --host ...` CLI args, which the nuxi arg parser
# mis-handles here and ends up scaffolding a second, blank Nuxt project into
# a literal "--host" directory) — these are nuxi's own documented env-var
# fallbacks for the same settings.
ENV HOST=0.0.0.0
ENV PORT=3000
# Vite's dev server otherwise 403s any request whose Host header isn't
# localhost or a detected LAN address — which is exactly what Traefik
# forwards for the cal-dev.g4.lv route.
ENV __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=cal-dev.g4.lv
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "run", "dev"]

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/.output ./.output
# The boot-time migrator reads this folder from the working directory; it is not
# part of the Nitro bundle, so it has to be copied in alongside it.
COPY --from=build /app/server/database/migrations ./server/database/migrations

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
