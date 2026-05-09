FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

COPY src/server/ ./src/server/
COPY src/utils/ ./src/utils/

EXPOSE 3001

WORKDIR /app/src/server
CMD ["node", "index.js"]
