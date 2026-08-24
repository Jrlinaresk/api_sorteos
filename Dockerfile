# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.19.0-alpine3.23
ARG PNPM_VERSION=9.15.9

FROM node:${NODE_VERSION} AS dependencies
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV CI=true
ENV DO_NOT_TRACK=1
ENV SCARF_ANALYTICS=false
WORKDIR /app

RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY admin ./admin
RUN pnpm build \
  && pnpm prune --prod

FROM node:${NODE_VERSION} AS production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
WORKDIR /app

RUN apk add --no-cache dumb-init \
  && addgroup --system --gid 10001 api \
  && adduser --system --uid 10001 --ingroup api --home /app api \
  && mkdir -p /app/uploads/media /tmp/api-sorteos-media \
  && chown -R api:api /app /tmp/api-sorteos-media

COPY --from=builder --chown=api:api /app/package.json ./package.json
COPY --from=builder --chown=api:api /app/node_modules ./node_modules
COPY --from=builder --chown=api:api /app/dist ./dist
# EmailService todavía resuelve estas plantillas desde process.cwd()/src.
COPY --from=builder --chown=api:api /app/src/templates ./src/templates
COPY --from=builder --chown=api:api /app/src/assets ./src/assets

USER api:api
EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
