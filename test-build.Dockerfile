FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --production
