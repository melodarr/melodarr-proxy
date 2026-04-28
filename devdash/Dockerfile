FROM node:25-alpine

WORKDIR /app

RUN corepack enable
COPY package*.json ./
RUN yarn install

COPY . .

EXPOSE 3000

CMD ["yarn", "dev"]
