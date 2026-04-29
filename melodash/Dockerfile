FROM node:24-alpine AS base

WORKDIR /app

RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .
RUN yarn build
RUN rm -rf node_modules .yarn/cache \
  && node -e "const fs=require('fs'); const p=require('./package.json'); delete p.devDependencies; fs.writeFileSync('package.json', JSON.stringify(p, null, 2))" \
  && npm install --omit=dev --ignore-scripts \
  && rm -f yarn.lock .yarnrc.yml

EXPOSE 3000

CMD ["npm", "run", "start"]
