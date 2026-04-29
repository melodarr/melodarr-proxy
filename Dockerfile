FROM node:20-bookworm-slim@sha256:59bdcc083652886c9d74dfa98cc1b297cce30b05b8a69e38d49a37cce14ed4fa AS base
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./

FROM base AS dev
RUN yarn install
COPY . .

FROM dev AS test
RUN yarn lint
RUN yarn test

FROM base AS production
ENV NODE_ENV=production
ARG APP_VERSION
ARG APP_REVISION
ARG APP_CREATED
ENV APP_VERSION=$APP_VERSION
ENV APP_REVISION=$APP_REVISION
ENV APP_CREATED=$APP_CREATED
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu wget \
  && rm -rf /var/lib/apt/lists/*
RUN yarn install --immutable
COPY src ./src
COPY public ./public
RUN groupadd --system melodarr \
  && useradd --system --gid melodarr --home-dir /app --shell /usr/sbin/nologin melodarr \
  && mkdir -p /data \
  && chown -R melodarr:melodarr /app /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["sh", "-c", "chown -R melodarr:melodarr /data && exec gosu melodarr node src/server.js"]
