FROM node:22-alpine

RUN apk upgrade --no-cache

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

ENV NODE_ENV=production

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

CMD ["node", "src/server/index.js"]
