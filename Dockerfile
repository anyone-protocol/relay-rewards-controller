# BUILD
FROM node:20.14-alpine As build

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

ENV NODE_ENV production

RUN npm ci --only=production && npm cache clean --force

USER node

# PRODUCTION
FROM node:20.14-alpine As production

COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist

ENV NODE_OPTIONS=--max-old-space-size=2048

CMD [ "node", "dist/main.js" ]
