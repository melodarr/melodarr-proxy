FROM node:20-alpine

WORKDIR /app

RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .

EXPOSE 3000

CMD ["yarn", "dev"]
